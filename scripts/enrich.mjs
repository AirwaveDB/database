#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const STATIONS = join(DATA, 'stations');
const pretty = (value) => JSON.stringify(value, null, 2) + '\n';

// These rules only promote explicit tag evidence. No country-, name-, or
// popularity-based guessing is used here.
const CATEGORY_RULES = new Map([
  ['news', ['news', 'noticias', 'nachrichten', 'actualités', 'nieuws']],
  ['talk', ['talk', 'talk radio', 'spoken word']],
  ['sports', ['sports', 'sport', 'deportes']],
  ['public', ['public radio', 'public broadcaster', 'öffentlich-rechtlich']],
  ['community', ['community radio', 'community']],
  ['college', ['college radio', 'university radio', 'campus radio']],
  ['pop', ['pop', 'top 40', 'top40', 'hits', 'charts']],
  ['rock', ['rock', 'classic rock', 'hard rock', 'alternative rock']],
  ['jazz', ['jazz', 'smooth jazz']],
  ['classical', ['classical', 'klassik', 'opera']],
  ['electronic', ['electronic', 'electronica', 'edm', 'techno', 'trance', 'house']],
  ['hip-hop', ['hip hop', 'hip-hop', 'hiphop', 'rap']],
  ['country', ['country', 'country music']],
  ['folk', ['folk', 'folk music']],
  ['religious', ['religious', 'christian', 'catholic', 'gospel', 'islamic', 'quran']],
  ['oldies', ['oldies', '50s', '60s', '70s', '80s', '90s']],
  ['latin', ['latin', 'latino', 'salsa', 'cumbia', 'bachata', 'reggaeton']],
  ['reggae', ['reggae', 'dub']],
  ['blues', ['blues']],
  ['metal', ['metal', 'heavy metal']],
  ['punk', ['punk', 'punk rock']],
  ['ambient', ['ambient', 'chillout', 'chill', 'lounge', 'meditation']],
  ['anime', ['anime', 'j-pop', 'jpop', 'k-pop', 'kpop']],
  ['kids', ['kids', 'children', "children's music"]],
  ['christmas', ['christmas', 'xmas', 'navidad', 'weihnachten']],
]);

const TYPE_RULES = [
  ['public', ['public radio', 'public broadcaster', 'öffentlich-rechtlich']],
  ['community', ['community radio', 'community']],
  ['college', ['college radio', 'university radio', 'campus radio']],
  ['internet', ['internet radio', 'webradio']],
];

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phrasePresent(tag, alias) {
  const text = ` ${normalize(tag)} `;
  const phrase = ` ${normalize(alias)} `;
  return phrase.trim() && text.includes(phrase);
}

function derivedCategories(tags) {
  const out = [];
  for (const [id, aliases] of CATEGORY_RULES) {
    if (tags.some((tag) => aliases.some((alias) => phrasePresent(tag, alias)))) out.push(id);
  }
  return out;
}

function derivedType(tags) {
  for (const [type, aliases] of TYPE_RULES) {
    if (tags.some((tag) => aliases.some((alias) => phrasePresent(tag, alias)))) return type;
  }
  return null;
}

async function main() {
  const files = (await readdir(STATIONS)).filter((name) => /^[A-Z]{2}\.json$/.test(name)).sort();
  const categoryCounts = new Map([...CATEGORY_RULES.keys()].map((id) => [id, 0]));
  let stationCount = 0;
  let withHomepage = 0;
  let withFavicon = 0;
  let withLanguage = 0;
  let withCategory = 0;
  let withType = 0;
  let categoryAdditions = 0;
  let typeAdditions = 0;

  for (const file of files) {
    const path = join(STATIONS, file);
    const rows = JSON.parse(await readFile(path, 'utf8'));

    for (const station of rows) {
      const existing = new Set(station.categories || []);
      for (const category of derivedCategories(station.tags || [])) {
        if (!existing.has(category)) categoryAdditions++;
        existing.add(category);
      }
      station.categories = [...existing].sort();

      if (!station.type) {
        const type = derivedType(station.tags || []);
        if (type) {
          station.type = type;
          typeAdditions++;
        }
      }

      stationCount++;
      if (station.homepage) withHomepage++;
      if (station.favicon) withFavicon++;
      if (station.languages?.length) withLanguage++;
      if (station.categories.length) withCategory++;
      if (station.type) withType++;
      for (const category of station.categories) {
        categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
      }
    }

    await writeFile(path, pretty(rows));
  }

  const categories = [...CATEGORY_RULES.keys()].map((id) => ({
    id,
    stationCount: categoryCounts.get(id) || 0,
  }));
  await writeFile(join(DATA, 'categories.json'), pretty(categories));

  const indexPath = join(DATA, 'index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  index.quality = {
    ...(index.quality || {}),
    withHomepage,
    withFavicon,
    withLanguage,
    withCategory,
    withType,
  };
  await writeFile(indexPath, pretty(index));

  process.stdout.write(
    `Enriched ${stationCount} stations: +${categoryAdditions} category assignments, +${typeAdditions} station types\n`,
  );
}

await main();
