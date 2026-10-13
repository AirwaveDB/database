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
const TYPES = new Set([null, 'public', 'community', 'college', 'internet']);
const errors = [];

function fail(message) {
  if (errors.length < 200) errors.push(message);
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
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

async function main() {
  const [categories, sourceMap, redirects, countries, languages, index] = await Promise.all([
    json(join(DATA, 'categories.json')),
    json(join(DATA, 'source_map.json')),
    json(join(DATA, 'redirects.json')),
    json(join(DATA, 'countries.json')),
    json(join(DATA, 'languages.json')),
    json(join(DATA, 'index.json')),
  ]);

  const allowedCategories = new Set(categories.map((r) => r.id));
  const files = (await readdir(STATIONS)).filter((name) => /^[A-Z]{2}\.json$/.test(name)).sort();
  if (!files.length) fail('data/stations: no country files found');

  const ids = new Set();
  const countryCounts = new Map();
  const languageCounts = new Map();
  const categoryCounts = new Map();
  let stationCount = 0;

  for (const file of files) {
    const code = file.slice(0, 2);
    const rows = await json(join(STATIONS, file));
    if (!Array.isArray(rows)) { fail(`${file}: expected JSON array`); continue; }
    countryCounts.set(code, rows.length);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const where = `${file}[${i}]`;
      stationCount++;
      if (!STATION_ID.test(row.id)) fail(`${where}: invalid station id ${row.id}`);
      if (ids.has(row.id)) fail(`${where}: duplicate station id ${row.id}`);
      ids.add(row.id);
      if (!row.name) fail(`${where}: empty station name`);
      if (row.country !== code || !COUNTRY.test(row.country)) fail(`${where}: country does not match filename`);
      if (!TYPES.has(row.type)) fail(`${where}: invalid station type ${row.type}`);
      if (!Number.isInteger(row.sourceCount) || row.sourceCount < 1) fail(`${where}: invalid sourceCount`);
      if (!Array.isArray(row.languages)) fail(`${where}: languages must be an array`);
      if (!Array.isArray(row.categories)) fail(`${where}: categories must be an array`);
      if (!Array.isArray(row.tags)) fail(`${where}: tags must be an array`);
      for (const lang of row.languages || []) {
        if (!LANGUAGE.test(lang)) fail(`${where}: invalid language code ${lang}`);
        languageCounts.set(lang, (languageCounts.get(lang) || 0) + 1);
      }
      for (const category of row.categories || []) {
        if (!allowedCategories.has(category)) fail(`${where}: unknown category ${category}`);
        categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
      }
      checkUrl(row.homepage, `${where} homepage`);
      checkUrl(row.favicon, `${where} favicon`);
    }
  }

  const sourceKeys = new Set();
  for (let i = 0; i < sourceMap.length; i++) {
    const row = sourceMap[i];
    const where = `source_map.json[${i}]`;
    const key = `${row.source}:${row.sourceId}`;
    if (!row.source || !row.sourceId) fail(`${where}: missing source identifier`);
    if (sourceKeys.has(key)) fail(`${where}: duplicate source identifier ${key}`);
    sourceKeys.add(key);
    if (!ids.has(row.stationId)) fail(`${where}: unknown station id ${row.stationId}`);
    if (!COUNTRY.test(row.country)) fail(`${where}: invalid country ${row.country}`);
  }

  const redirectIds = new Set();
  for (let i = 0; i < redirects.length; i++) {
    const row = redirects[i];
    const where = `redirects.json[${i}]`;
    if (!STATION_ID.test(row.oldId)) fail(`${where}: invalid old id ${row.oldId}`);
    if (!ids.has(row.stationId)) fail(`${where}: target station does not exist ${row.stationId}`);
    if (row.oldId === row.stationId) fail(`${where}: self redirect`);
    if (redirectIds.has(row.oldId)) fail(`${where}: duplicate old id ${row.oldId}`);
    redirectIds.add(row.oldId);
  }

  if (countries.length !== countryCounts.size) fail(`countries.json: ${countries.length} entries != ${countryCounts.size} files`);
  for (const row of countries) {
    const actual = countryCounts.get(row.code);
    if (actual === undefined) fail(`countries.json: missing station file for ${row.code}`);
    else if (actual !== Number(row.stationCount)) fail(`countries.json: count mismatch for ${row.code}: ${row.stationCount} != ${actual}`);
  }

  for (const row of languages) {
    const actual = languageCounts.get(row.code) || 0;
    if (actual !== Number(row.stationCount)) fail(`languages.json: count mismatch for ${row.code}: ${row.stationCount} != ${actual}`);
  }

  for (const row of categories) {
    const actual = categoryCounts.get(row.id) || 0;
    if (actual !== Number(row.stationCount)) fail(`categories.json: count mismatch for ${row.id}: ${row.stationCount} != ${actual}`);
  }

  if (Number(index.stationCount) !== stationCount) fail(`index.json: stationCount ${index.stationCount} != ${stationCount}`);
  if (index.countries?.length !== countryCounts.size) fail(`index.json: country count ${index.countries?.length} != ${countryCounts.size}`);
  if (Number(index.sourceRecordCount) < sourceMap.length) fail(`index.json: sourceRecordCount ${index.sourceRecordCount} < ${sourceMap.length} mappings`);

  if (errors.length) {
    for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
    process.stderr.write(`Validation failed with ${errors.length}${errors.length === 200 ? '+' : ''} errors\n`);
    process.exit(1);
  }

  process.stdout.write(`Validated ${stationCount} stations, ${sourceMap.length} source mappings, and ${countryCounts.size} country files\n`);
}

await main();
