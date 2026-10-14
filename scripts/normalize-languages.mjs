#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const STATIONS = join(DATA, 'stations');
const CODE = /^[a-z]{2,3}$/;
const pretty = (value) => JSON.stringify(value, null, 2) + '\n';

// Exact ISO 639 aliases only. Macrolanguages and related-but-distinct languages
// (for example cmn -> zh) are intentionally not collapsed.
const LANGUAGE_ALIASES = new Map([
  ['afr', 'af'],
  ['alb', 'sq'], ['sqi', 'sq'],
  ['amh', 'am'],
  ['ara', 'ar'],
  ['arm', 'hy'], ['hye', 'hy'],
  ['aze', 'az'],
  ['baq', 'eu'], ['eus', 'eu'],
  ['bel', 'be'],
  ['ben', 'bn'],
  ['bod', 'bo'], ['tib', 'bo'],
  ['bos', 'bs'],
  ['bul', 'bg'],
  ['bur', 'my'], ['mya', 'my'],
  ['cat', 'ca'],
  ['ces', 'cs'], ['cze', 'cs'],
  ['chi', 'zh'], ['zho', 'zh'],
  ['cym', 'cy'], ['wel', 'cy'],
  ['dan', 'da'],
  ['deu', 'de'], ['ger', 'de'],
  ['dut', 'nl'], ['nld', 'nl'],
  ['ell', 'el'], ['gre', 'el'],
  ['eng', 'en'],
  ['est', 'et'],
  ['fas', 'fa'], ['per', 'fa'],
  ['fin', 'fi'],
  ['fra', 'fr'], ['fre', 'fr'],
  ['geo', 'ka'], ['kat', 'ka'],
  ['gle', 'ga'],
  ['gla', 'gd'],
  ['glg', 'gl'],
  ['guj', 'gu'],
  ['heb', 'he'],
  ['hin', 'hi'],
  ['hrv', 'hr'],
  ['hun', 'hu'],
  ['ice', 'is'], ['isl', 'is'],
  ['ind', 'id'],
  ['ita', 'it'],
  ['jpn', 'ja'],
  ['kan', 'kn'],
  ['kaz', 'kk'],
  ['khm', 'km'],
  ['kir', 'ky'],
  ['kor', 'ko'],
  ['kur', 'ku'],
  ['lat', 'la'],
  ['lav', 'lv'],
  ['lit', 'lt'],
  ['mac', 'mk'], ['mkd', 'mk'],
  ['mal', 'ml'],
  ['mao', 'mi'], ['mri', 'mi'],
  ['mar', 'mr'],
  ['may', 'ms'], ['msa', 'ms'],
  ['mlt', 'mt'],
  ['mon', 'mn'],
  ['nep', 'ne'],
  ['nor', 'no'],
  ['ori', 'or'],
  ['pan', 'pa'],
  ['pol', 'pl'],
  ['por', 'pt'],
  ['ron', 'ro'], ['rum', 'ro'],
  ['rus', 'ru'],
  ['san', 'sa'],
  ['slk', 'sk'], ['slo', 'sk'],
  ['slv', 'sl'],
  ['spa', 'es'],
  ['sqi', 'sq'],
  ['srp', 'sr'],
  ['swa', 'sw'],
  ['swe', 'sv'],
  ['tam', 'ta'],
  ['tel', 'te'],
  ['tha', 'th'],
  ['tur', 'tr'],
  ['ukr', 'uk'],
  ['urd', 'ur'],
  ['vie', 'vi'],
]);

function normalize(code) {
  const value = String(code || '').trim().toLowerCase();
  if (!CODE.test(value)) return null;
  return LANGUAGE_ALIASES.get(value) || value;
}

async function main() {
  const files = (await readdir(STATIONS)).filter((name) => /^[A-Z]{2}\.json$/.test(name)).sort();
  const languageCounts = new Map();
  let withLanguage = 0;
  let normalizedLanguageValues = 0;
  let changedFiles = 0;

  for (const file of files) {
    const path = join(STATIONS, file);
    const rows = JSON.parse(await readFile(path, 'utf8'));
    let changed = false;

    for (const station of rows) {
      const original = Array.isArray(station.languages) ? station.languages : [];
      const normalized = [...new Set(original.map((code) => normalize(code)).filter(Boolean))].sort();
      normalizedLanguageValues += original.filter((code) => LANGUAGE_ALIASES.has(String(code).toLowerCase())).length;

      if (JSON.stringify(original) !== JSON.stringify(normalized)) {
        station.languages = normalized;
        changed = true;
      }

      if (normalized.length) withLanguage++;
      for (const code of normalized) languageCounts.set(code, (languageCounts.get(code) || 0) + 1);
    }

    if (changed) {
      await writeFile(path, pretty(rows));
      changedFiles++;
    }
  }

  const languages = [...languageCounts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, stationCount]) => ({ code, stationCount }));

  const activeCodes = new Set(languages.map((item) => item.code));
  const aliases = [...LANGUAGE_ALIASES]
    .filter(([alias, code]) => alias !== code && activeCodes.has(code))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([alias, code]) => ({ alias, code }));

  const indexPath = join(DATA, 'index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  index.languageCount = languages.length;
  index.languageAliasCount = aliases.length;
  index.quality = {
    ...(index.quality || {}),
    withLanguage,
    normalizedLanguageValues,
  };

  await Promise.all([
    writeFile(join(DATA, 'languages.json'), pretty(languages)),
    writeFile(join(DATA, 'language_aliases.json'), pretty(aliases)),
    writeFile(indexPath, pretty(index)),
  ]);

  process.stdout.write(
    `Languages: ${languages.length} canonical codes, ${aliases.length} aliases, ${normalizedLanguageValues} normalized values across ${changedFiles} files\n`,
  );
}

await main();
