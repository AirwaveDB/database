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

function unique(values) {
  return Array.isArray(values) && new Set(values).size === values.length;
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

  const allowedCategories = new Set(categories.map((row) => row.id));
  const files = (await readdir(STATIONS)).filter((name) => /^[A-Z]{2}\.json$/.test(name)).sort();
  if (!files.length) fail('data/stations: no country files found');

  const ids = new Set();
  const stationsById = new Map();
  const countryCounts = new Map();
  const languageCounts = new Map();
  const categoryCounts = new Map();
  let stationCount = 0;
  let withHomepage = 0;
  let withFavicon = 0;
  let withLanguage = 0;
  let withCategory = 0;

  for (const file of files) {
    const code = file.slice(0, 2);
    const rows = await json(join(STATIONS, file));
    if (!Array.isArray(rows)) {
      fail(`${file}: expected JSON array`);
      continue;
    }
    countryCounts.set(code, rows.length);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const where = `${file}[${i}]`;
      stationCount++;

      if (!STATION_ID.test(row.id)) fail(`${where}: invalid station id ${row.id}`);
      if (ids.has(row.id)) fail(`${where}: duplicate station id ${row.id}`);
      ids.add(row.id);
      stationsById.set(row.id, row);

      if (!row.name || typeof row.name !== 'string') fail(`${where}: empty station name`);
      if (row.country !== code || !COUNTRY.test(row.country)) fail(`${where}: country does not match filename`);
      if (!TYPES.has(row.type)) fail(`${where}: invalid station type ${row.type}`);
      if (!Number.isInteger(row.sourceCount) || row.sourceCount < 1) fail(`${where}: invalid sourceCount`);

      if (!Array.isArray(row.languages)) fail(`${where}: languages must be an array`);
      if (!Array.isArray(row.categories)) fail(`${where}: categories must be an array`);
      if (!Array.isArray(row.tags)) fail(`${where}: tags must be an array`);
      if (!unique(row.languages)) fail(`${where}: duplicate language values`);
      if (!unique(row.categories)) fail(`${where}: duplicate category values`);
      if (!unique(row.tags)) fail(`${where}: duplicate tag values`);

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
      if (row.updatedAt && Number.isNaN(Date.parse(row.updatedAt))) fail(`${where}: invalid updatedAt ${row.updatedAt}`);

      if (row.homepage) withHomepage++;
      if (row.favicon) withFavicon++;
      if (row.languages?.length) withLanguage++;
      if (row.categories?.length) withCategory++;
    }
  }

  const sourceKeys = new Set();
  const mappingsPerStation = new Map();
  for (let i = 0; i < sourceMap.length; i++) {
    const row = sourceMap[i];
    const where = `source_map.json[${i}]`;
    const key = `${row.source}:${row.sourceId}`;
    if (!row.source || !row.sourceId) fail(`${where}: missing source identifier`);
    if (sourceKeys.has(key)) fail(`${where}: duplicate source identifier ${key}`);
    sourceKeys.add(key);
    if (!ids.has(row.stationId)) fail(`${where}: unknown station id ${row.stationId}`);
    if (!COUNTRY.test(row.country)) fail(`${where}: invalid country ${row.country}`);
    mappingsPerStation.set(row.stationId, (mappingsPerStation.get(row.stationId) || 0) + 1);
  }

  for (const [id, station] of stationsById) {
    const actual = mappingsPerStation.get(id) || 0;
    if (station.sourceCount !== actual) {
      fail(`${id}: sourceCount ${station.sourceCount} != ${actual} source mappings`);
    }
  }

  const redirectIds = new Set();
  for (let i = 0; i < redirects.length; i++) {
    const row = redirects[i];
    const where = `redirects.json[${i}]`;
    if (!STATION_ID.test(row.oldId)) fail(`${where}: invalid old id ${row.oldId}`);
    if (!STATION_ID.test(row.stationId)) fail(`${where}: invalid target id ${row.stationId}`);
    if (ids.has(row.oldId)) fail(`${where}: redirected id is also an active station ${row.oldId}`);
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

  if (Number(index.schemaVersion) !== 1) fail(`index.json: unsupported schemaVersion ${index.schemaVersion}`);
  if (Number(index.stationCount) !== stationCount) fail(`index.json: stationCount ${index.stationCount} != ${stationCount}`);
  if (Number(index.sourceRecordCount) !== sourceMap.length) fail(`index.json: sourceRecordCount ${index.sourceRecordCount} != ${sourceMap.length}`);
  if (Number(index.redirectCount) !== redirects.length) fail(`index.json: redirectCount ${index.redirectCount} != ${redirects.length}`);
  if (index.countries?.length !== countryCounts.size) fail(`index.json: country count ${index.countries?.length} != ${countryCounts.size}`);

  const quality = index.quality || {};
  if (Number(quality.withHomepage) !== withHomepage) fail(`index.json: quality.withHomepage ${quality.withHomepage} != ${withHomepage}`);
  if (Number(quality.withFavicon) !== withFavicon) fail(`index.json: quality.withFavicon ${quality.withFavicon} != ${withFavicon}`);
  if (Number(quality.withLanguage) !== withLanguage) fail(`index.json: quality.withLanguage ${quality.withLanguage} != ${withLanguage}`);
  if (Number(quality.withCategory) !== withCategory) fail(`index.json: quality.withCategory ${quality.withCategory} != ${withCategory}`);
  if (Number(quality.unknownCountry) !== (countryCounts.get('ZZ') || 0)) {
    fail(`index.json: quality.unknownCountry ${quality.unknownCountry} != ${countryCounts.get('ZZ') || 0}`);
  }

  if (errors.length) {
    for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
    process.stderr.write(`Validation failed with ${errors.length}${errors.length === 200 ? '+' : ''} errors\n`);
    process.exit(1);
  }

  process.stdout.write(
    `Validated ${stationCount} stations, ${sourceMap.length} source mappings, ${redirects.length} redirects, and ${countryCounts.size} country files\n`,
  );
}

await main();
