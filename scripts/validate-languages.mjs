#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const STATIONS = join(DATA, 'stations');
const CODE = /^[a-z]{2,3}$/;
const errors = [];

function fail(message) {
  if (errors.length < 200) errors.push(message);
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const [languages, aliases, index] = await Promise.all([
    json(join(DATA, 'languages.json')),
    json(join(DATA, 'language_aliases.json')),
    json(join(DATA, 'index.json')),
  ]);

  const canonicalCodes = new Set();
  for (const item of languages) {
    if (!CODE.test(item.code || '')) fail(`invalid canonical language code ${item.code}`);
    if (canonicalCodes.has(item.code)) fail(`duplicate canonical language code ${item.code}`);
    canonicalCodes.add(item.code);
  }

  const aliasCodes = new Set();
  for (const item of aliases) {
    if (!CODE.test(item.alias || '')) fail(`invalid language alias ${item.alias}`);
    if (!CODE.test(item.code || '')) fail(`invalid language alias target ${item.code}`);
    if (item.alias === item.code) fail(`self language alias ${item.alias}`);
    if (aliasCodes.has(item.alias)) fail(`duplicate language alias ${item.alias}`);
    if (canonicalCodes.has(item.alias)) fail(`language alias ${item.alias} is also canonical`);
    if (!canonicalCodes.has(item.code)) fail(`language alias ${item.alias} targets missing canonical code ${item.code}`);
    aliasCodes.add(item.alias);
  }

  const counts = new Map();
  let withLanguage = 0;
  const files = (await readdir(STATIONS)).filter((name) => /^[A-Z]{2}\.json$/.test(name)).sort();
  for (const file of files) {
    const rows = await json(join(STATIONS, file));
    for (let i = 0; i < rows.length; i++) {
      const station = rows[i];
      const values = station.languages || [];
      if (!Array.isArray(values)) {
        fail(`${file}[${i}]: languages must be an array`);
        continue;
      }
      if (values.length) withLanguage++;
      for (const code of values) {
        if (!CODE.test(code)) fail(`${file}[${i}]: invalid language code ${code}`);
        if (aliasCodes.has(code)) fail(`${file}[${i}]: non-canonical language alias ${code}`);
        counts.set(code, (counts.get(code) || 0) + 1);
      }
    }
  }

  for (const item of languages) {
    const actual = counts.get(item.code) || 0;
    if (actual !== Number(item.stationCount)) {
      fail(`languages.json: ${item.code} stationCount ${item.stationCount} != ${actual}`);
    }
  }
  for (const code of counts.keys()) {
    if (!canonicalCodes.has(code)) fail(`languages.json: missing canonical language ${code}`);
  }

  if (Number(index.languageCount) !== languages.length) {
    fail(`index.json: languageCount ${index.languageCount} != ${languages.length}`);
  }
  if (Number(index.languageAliasCount) !== aliases.length) {
    fail(`index.json: languageAliasCount ${index.languageAliasCount} != ${aliases.length}`);
  }
  if (Number(index.quality?.withLanguage) !== withLanguage) {
    fail(`index.json: quality.withLanguage ${index.quality?.withLanguage} != ${withLanguage}`);
  }

  if (errors.length) {
    for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
    process.stderr.write(`Language validation failed with ${errors.length}${errors.length === 200 ? '+' : ''} errors\n`);
    process.exit(1);
  }

  process.stdout.write(`Validated ${languages.length} canonical language codes and ${aliases.length} aliases\n`);
}

await main();
