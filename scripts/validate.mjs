#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const STATIONS = join(DATA, 'stations');
const STATION_ID = /^awb_[0-9a-f]{20}$/;
const COUNTRY = /^[A-Z]{2}$/;
const LANGUAGE = /^[a-z]{2,3}$/;
const TYPES = new Set(['', 'public', 'community', 'college', 'internet']);
const EXPECTED_HEADERS = ['id','name','country','subdivision','language_codes','categories','tags','homepage','favicon','type','source_count','updated_at'];
const errors = [];

function fail(message) {
  if (errors.length < 200) errors.push(message);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows.shift();
  return {
    headers,
    rows: rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))),
  };
}

function checkUrl(value, where) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) fail(`${where}: unsupported URL protocol`);
  } catch {
    fail(`${where}: invalid URL`);
  }
}

async function csvFile(path) {
  return parseCsv(await readFile(path, 'utf8'));
}

async function main() {
  const categoryFile = await csvFile(join(DATA, 'categories.csv'));
  const allowedCategories = new Set(categoryFile.rows.map((r) => r.id));
  const files = (await readdir(STATIONS)).filter((name) => /^[A-Z]{2}\.csv$/.test(name)).sort();
  if (!files.length) fail('data/stations: no country files found');

  const ids = new Set();
  const countryCounts = new Map();
  let stationCount = 0;

  for (const file of files) {
    const code = file.slice(0, 2);
    const parsed = await csvFile(join(STATIONS, file));
    if (parsed.headers.join(',') !== EXPECTED_HEADERS.join(',')) fail(`${file}: unexpected header`);
    countryCounts.set(code, parsed.rows.length);

    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      const where = `${file}:${i + 2}`;
      stationCount++;
      if (!STATION_ID.test(row.id)) fail(`${where}: invalid station id ${row.id}`);
      if (ids.has(row.id)) fail(`${where}: duplicate station id ${row.id}`);
      ids.add(row.id);
      if (!row.name) fail(`${where}: empty station name`);
      if (row.country !== code || !COUNTRY.test(row.country)) fail(`${where}: country does not match filename`);
      if (!TYPES.has(row.type)) fail(`${where}: invalid station type ${row.type}`);
      if (!/^\d+$/.test(row.source_count) || Number(row.source_count) < 1) fail(`${where}: invalid source_count`);
      for (const lang of row.language_codes.split(';').filter(Boolean)) if (!LANGUAGE.test(lang)) fail(`${where}: invalid language code ${lang}`);
      for (const category of row.categories.split(';').filter(Boolean)) if (!allowedCategories.has(category)) fail(`${where}: unknown category ${category}`);
      checkUrl(row.homepage, `${where} homepage`);
      checkUrl(row.favicon, `${where} favicon`);
    }
  }

  const sourceMap = await csvFile(join(DATA, 'source_map.csv'));
  const sourceKeys = new Set();
  for (let i = 0; i < sourceMap.rows.length; i++) {
    const row = sourceMap.rows[i];
    const where = `source_map.csv:${i + 2}`;
    const key = `${row.source}:${row.source_id}`;
    if (!row.source || !row.source_id) fail(`${where}: missing source identifier`);
    if (sourceKeys.has(key)) fail(`${where}: duplicate source identifier ${key}`);
    sourceKeys.add(key);
    if (!ids.has(row.station_id)) fail(`${where}: unknown station id ${row.station_id}`);
    if (!COUNTRY.test(row.country)) fail(`${where}: invalid country ${row.country}`);
  }

  const redirects = await csvFile(join(DATA, 'redirects.csv'));
  const redirectIds = new Set();
  for (let i = 0; i < redirects.rows.length; i++) {
    const row = redirects.rows[i];
    const where = `redirects.csv:${i + 2}`;
    if (!STATION_ID.test(row.old_id)) fail(`${where}: invalid old id ${row.old_id}`);
    if (!ids.has(row.station_id)) fail(`${where}: target station does not exist ${row.station_id}`);
    if (row.old_id === row.station_id) fail(`${where}: self redirect`);
    if (redirectIds.has(row.old_id)) fail(`${where}: duplicate old id ${row.old_id}`);
    redirectIds.add(row.old_id);
  }

  const countries = await csvFile(join(DATA, 'countries.csv'));
  for (const row of countries.rows) {
    const actual = countryCounts.get(row.code);
    if (actual === undefined) fail(`countries.csv: missing station file for ${row.code}`);
    else if (actual !== Number(row.station_count)) fail(`countries.csv: count mismatch for ${row.code}: ${row.station_count} != ${actual}`);
  }

  const index = JSON.parse(await readFile(join(DATA, 'index.json'), 'utf8'));
  if (Number(index.station_count) !== stationCount) fail(`index.json: station_count ${index.station_count} != ${stationCount}`);
  if (index.countries?.length !== countryCounts.size) fail(`index.json: country count ${index.countries?.length} != ${countryCounts.size}`);

  if (errors.length) {
    for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
    process.stderr.write(`Validation failed with ${errors.length}${errors.length === 200 ? '+' : ''} errors\n`);
    process.exit(1);
  }

  process.stdout.write(`Validated ${stationCount} stations, ${sourceMap.rows.length} source mappings, and ${countryCounts.size} country files\n`);
}

await main();
