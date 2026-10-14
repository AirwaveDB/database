#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const STATIONS_DIR = join(DATA, 'stations');
const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];
const USER_AGENT = 'AirwaveDB-database/1.2 (+https://github.com/AirwaveDB/database)';
const VERIFIED_URL = 'https://raw.githubusercontent.com/eyalev/verified-radio-streams/main/stations/all.json';
const PAGE_SIZE = 5000;
const TIMEOUT_MS = 20_000;
const MIN_RADIO_BROWSER_ROWS = 40_000;
const MIN_KEEP_RATIO = 0.80;
const ALLOW_SHRINK = process.env.ALLOW_SHRINK === '1';

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

const LINE_BREAKS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const BIDI = /[\u202a-\u202e\u2066-\u2069\ufeff]/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATION_ID_RE = /^awb_[0-9a-f]{20}$/;
const pretty = (value) => JSON.stringify(value, null, 2) + '\n';

function clean(value, max = 500) {
  return Array.from(String(value ?? '').replace(LINE_BREAKS, ' ').replace(BIDI, '').replace(/\s+/g, ' ').trim()).slice(0, max).join('');
}

function validUrl(value) {
  try {
    const u = new URL(clean(value, 2000));
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function countryCode(value) {
  const code = clean(value, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : 'ZZ';
}

function keyText(value) {
  return clean(value, 300)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stationKey(row) {
  const cc = countryCode(row.countryCode);
  const name = keyText(row.name);
  const discriminator = hostOf(row.homepage) || row.streamHost || keyText(row.state);
  return `${cc}|${name}|${discriminator}`;
}

function stationId(key) {
  return `awb_${createHash('sha256').update(key).digest('hex').slice(0, 20)}`;
}

async function fetchWithTimeout(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res;
}

async function radioBrowser(path) {
  const errors = [];
  for (const base of MIRRORS) {
    try {
      return await (await fetchWithTimeout(base + path)).json();
    } catch (error) {
      errors.push(`${base}: ${error.message}`);
    }
  }
  throw new Error(`Radio Browser request failed: ${path}\n${errors.join('\n')}`);
}

async function fetchRadioBrowser() {
  const out = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await radioBrowser(`/json/stations/search?hidebroken=true&order=name&limit=${PAGE_SIZE}&offset=${offset}`);
    if (!Array.isArray(page)) throw new Error('Radio Browser returned an unexpected response');
    out.push(...page);
    process.stdout.write(`Radio Browser: ${out.length}\n`);
    if (page.length < PAGE_SIZE) break;
  }
  if (out.length < MIN_RADIO_BROWSER_ROWS && !ALLOW_SHRINK) {
    throw new Error(`Radio Browser returned only ${out.length} working entries; refusing to replace the dataset`);
  }
  return out;
}

function collectVerified(node, out, inherited = {}) {
  if (Array.isArray(node)) {
    for (const item of node) collectVerified(item, out, inherited);
    return;
  }
  if (!node || typeof node !== 'object') return;

  const context = {
    countryCode: node.countryCode || node.code || inherited.countryCode || '',
    country: node.country || inherited.country || '',
  };

  if (typeof node.name === 'string' && typeof node.stream === 'string') {
    out.push({ ...node, ...context });
    return;
  }

  for (const value of Object.values(node)) collectVerified(value, out, context);
}

async function fetchVerified() {
  const data = await (await fetchWithTimeout(VERIFIED_URL)).json();
  const out = [];
  collectVerified(data, out);
  if (!out.length) throw new Error('verified-radio-streams returned no stream records');
  process.stdout.write(`Verified streams: ${out.length}\n`);
  return out;
}

async function previousMappings() {
  try {
    const rows = JSON.parse(await readFile(join(DATA, 'source_map.json'), 'utf8'));
    return new Map(rows.map((r) => [`${r.source}:${r.sourceId}`, r.stationId]));
  } catch {
    return new Map();
  }
}

async function previousRedirects() {
  try {
    const rows = JSON.parse(await readFile(join(DATA, 'redirects.json'), 'utf8'));
    return rows.filter((r) => STATION_ID_RE.test(r.oldId) && STATION_ID_RE.test(r.stationId));
  } catch {
    return [];
  }
}

async function previousCount() {
  try {
    const index = JSON.parse(await readFile(join(DATA, 'index.json'), 'utf8'));
    return Number(index.stationCount ?? 0);
  } catch {
    return 0;
  }
}

function rbRow(s) {
  if (!UUID_RE.test(String(s.stationuuid ?? ''))) return null;
  const name = clean(s.name, 160);
  const stream = validUrl(s.url_resolved || s.url);
  if (!name || !stream) return null;

  const languages = clean(s.languagecodes, 200)
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[a-z]{2,3}$/.test(x));
  const tags = clean(s.tags, 1000)
    .split(',')
    .map((x) => clean(x, 60).toLowerCase())
    .filter(Boolean)
    .slice(0, 40);

  return {
    source: 'radio-browser',
    sourceId: String(s.stationuuid).toLowerCase(),
    name,
    countryCode: countryCode(s.countrycode),
    country: clean(s.country, 100),
    state: clean(s.state, 100),
    homepage: validUrl(s.homepage),
    favicon: validUrl(s.favicon),
    streamHost: hostOf(stream),
    languages,
    tags,
    votes: Number.isFinite(Number(s.votes)) ? Number(s.votes) : 0,
    clicks: Number.isFinite(Number(s.clickcount)) ? Number(s.clickcount) : 0,
    changedAt: clean(s.changetimestamp_iso8601 || s.lastchangetime_iso8601 || '', 40),
  };
}

function verifiedRow(s) {
  const name = clean(s.name, 160);
  const sourceLocalId = clean(s.id, 200);
  if (!name || !sourceLocalId) return null;

  const stream = validUrl(s.stream);
  if (!stream) return null;
  const sourceId = `${countryCode(s.countryCode)}:${sourceLocalId}`;

  return {
    source: 'verified-radio-streams',
    sourceId,
    name,
    countryCode: countryCode(s.countryCode),
    country: clean(s.country, 100),
    state: clean(s.state, 100),
    homepage: validUrl(s.url),
    favicon: '',
    streamHost: hostOf(stream),
    languages: Array.isArray(s.langCodes)
      ? s.langCodes.map((x) => clean(x, 3).toLowerCase()).filter((x) => /^[a-z]{2,3}$/.test(x))
      : [],
    tags: Array.isArray(s.genre)
      ? s.genre.map((x) => clean(x, 60).toLowerCase()).filter(Boolean)
      : [],
    votes: Number.isFinite(Number(s.votes)) ? Number(s.votes) : 0,
    clicks: Number.isFinite(Number(s.clicks)) ? Number(s.clicks) : 0,
    changedAt: clean(s.verified, 40),
  };
}

function categoriesFor(tags) {
  const set = new Set(tags.map((x) => keyText(x)));
  const out = [];
  for (const [id, aliases] of CATEGORY_RULES) {
    if (aliases.some((a) => set.has(keyText(a)))) out.push(id);
  }
  return out;
}

function chooseType(tags) {
  const t = new Set(tags.map(keyText));
  if (['public radio', 'public broadcaster', 'öffentlich-rechtlich'].some((x) => t.has(keyText(x)))) return 'public';
  if (['community radio', 'community'].some((x) => t.has(keyText(x)))) return 'community';
  if (['college radio', 'university radio', 'campus radio'].some((x) => t.has(keyText(x)))) return 'college';
  if (['internet radio', 'webradio'].some((x) => t.has(keyText(x)))) return 'internet';
  return null;
}

function newest(values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function dedupeSourceRows(rows) {
  const map = new Map();
  for (const row of rows.filter(Boolean)) {
    const key = `${row.source}:${row.sourceId}`;
    const old = map.get(key);
    if (!old || (row.votes + row.clicks) > (old.votes + old.clicks)) map.set(key, row);
  }
  return [...map.values()];
}

function clusterSources(rows, previousMap) {
  const parent = rows.map((_, i) => i);
  const rank = rows.map(() => 0);

  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  function union(a, b) {
    a = find(a);
    b = find(b);
    if (a === b) return;
    if (rank[a] < rank[b]) [a, b] = [b, a];
    parent[b] = a;
    if (rank[a] === rank[b]) rank[a]++;
  }

  const byCurrentKey = new Map();
  const byPreviousId = new Map();

  rows.forEach((row, i) => {
    const key = stationKey(row);
    if (byCurrentKey.has(key)) union(i, byCurrentKey.get(key));
    else byCurrentKey.set(key, i);

    const previousId = previousMap.get(`${row.source}:${row.sourceId}`);
    if (!previousId) return;
    if (byPreviousId.has(previousId)) union(i, byPreviousId.get(previousId));
    else byPreviousId.set(previousId, i);
  });

  const groups = new Map();
  rows.forEach((row, i) => {
    const root = find(i);
    const list = groups.get(root) || [];
    list.push(row);
    groups.set(root, list);
  });
  return [...groups.values()];
}

function chooseExistingId(rows, previousMap, fallbackKey) {
  const counts = new Map();
  for (const row of rows) {
    const id = previousMap.get(`${row.source}:${row.sourceId}`);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }

  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    id: ranked[0]?.[0] || stationId(fallbackKey),
    mergedIds: ranked.slice(1).map(([id]) => id),
  };
}

function flattenRedirects(previous, additions, activeIds) {
  const map = new Map();
  for (const row of previous) map.set(row.oldId, row.stationId);
  for (const row of additions) map.set(row.oldId, row.stationId);

  function resolve(start) {
    let id = start;
    const seen = new Set();
    while (map.has(id)) {
      if (seen.has(id)) return null;
      seen.add(id);
      id = map.get(id);
    }
    return id;
  }

  const out = [];
  for (const oldId of [...map.keys()].sort()) {
    if (activeIds.has(oldId)) continue;
    const target = resolve(map.get(oldId));
    if (!target || target === oldId || !activeIds.has(target)) continue;
    out.push({ oldId, stationId: target });
  }
  return out;
}

async function main() {
  const [rb, verified, previousMap, previousRedirectRows, oldCount] = await Promise.all([
    fetchRadioBrowser(),
    fetchVerified(),
    previousMappings(),
    previousRedirects(),
    previousCount(),
  ]);

  const sourceRows = dedupeSourceRows([...rb.map(rbRow), ...verified.map(verifiedRow)]);
  const groups = clusterSources(sourceRows, previousMap);

  const redirectAdditions = [];
  const sourceMap = [];
  const stations = [];

  for (const rows of groups) {
    const fallbackKey = [...rows].map(stationKey).sort()[0];
    const { id, mergedIds } = chooseExistingId(rows, previousMap, fallbackKey);
    for (const oldId of mergedIds) redirectAdditions.push({ oldId, stationId: id });

    const ranked = [...rows].sort((a, b) => (b.votes + b.clicks) - (a.votes + a.clicks));
    const tags = [...new Set(rows.flatMap((r) => r.tags))].sort();
    const languages = [...new Set(rows.flatMap((r) => r.languages))].sort();
    const best = ranked[0];

    stations.push({
      id,
      name: best.name,
      country: best.countryCode,
      subdivision: ranked.map((r) => r.state).find(Boolean) || null,
      languages,
      categories: categoriesFor(tags),
      tags,
      homepage: ranked.map((r) => r.homepage).find(Boolean) || null,
      favicon: ranked.map((r) => r.favicon).find(Boolean) || null,
      type: chooseType(tags),
      sourceCount: rows.length,
      updatedAt: newest(rows.map((r) => r.changedAt)),
    });

    for (const row of rows) {
      sourceMap.push({
        source: row.source,
        sourceId: row.sourceId,
        stationId: id,
        country: row.countryCode,
      });
    }
  }

  if (oldCount && stations.length < oldCount * MIN_KEEP_RATIO && !ALLOW_SHRINK) {
    throw new Error(`Station count dropped from ${oldCount} to ${stations.length}; refusing to overwrite the dataset`);
  }

  const activeIds = new Set(stations.map((station) => station.id));
  if (activeIds.size !== stations.length) throw new Error('Duplicate station IDs produced during clustering');
  const redirects = flattenRedirects(previousRedirectRows, redirectAdditions, activeIds);

  await mkdir(DATA, { recursive: true });
  await rm(STATIONS_DIR, { recursive: true, force: true });
  await mkdir(STATIONS_DIR, { recursive: true });

  const byCountry = new Map();
  for (const station of stations) {
    const list = byCountry.get(station.country) || [];
    list.push(station);
    byCountry.set(station.country, list);
  }

  const countries = [];
  for (const [code, rows] of [...byCountry].sort(([a], [b]) => a.localeCompare(b))) {
    rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
    await writeFile(join(STATIONS_DIR, `${code}.json`), pretty(rows));
    countries.push({ code, stationCount: rows.length });
  }

  sourceMap.sort((a, b) => a.source.localeCompare(b.source) || a.sourceId.localeCompare(b.sourceId));

  const languageCounts = new Map();
  const categoryCounts = new Map();
  let withHomepage = 0;
  let withFavicon = 0;
  let withLanguage = 0;
  let withCategory = 0;

  for (const station of stations) {
    if (station.homepage) withHomepage++;
    if (station.favicon) withFavicon++;
    if (station.languages.length) withLanguage++;
    if (station.categories.length) withCategory++;
    for (const code of station.languages) languageCounts.set(code, (languageCounts.get(code) || 0) + 1);
    for (const id of station.categories) categoryCounts.set(id, (categoryCounts.get(id) || 0) + 1);
  }

  const languages = [...languageCounts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, stationCount]) => ({ code, stationCount }));
  const categories = [...CATEGORY_RULES.keys()].map((id) => ({
    id,
    stationCount: categoryCounts.get(id) || 0,
  }));

  await Promise.all([
    writeFile(join(DATA, 'source_map.json'), pretty(sourceMap)),
    writeFile(join(DATA, 'redirects.json'), pretty(redirects)),
    writeFile(join(DATA, 'countries.json'), pretty(countries)),
    writeFile(join(DATA, 'languages.json'), pretty(languages)),
    writeFile(join(DATA, 'categories.json'), pretty(categories)),
    writeFile(join(DATA, 'index.json'), pretty({
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      stationCount: stations.length,
      sourceRecordCount: sourceRows.length,
      redirectCount: redirects.length,
      sources: {
        'radio-browser': rb.length,
        'verified-radio-streams': verified.length,
      },
      quality: {
        withHomepage,
        withFavicon,
        withLanguage,
        withCategory,
        unknownCountry: byCountry.get('ZZ')?.length || 0,
      },
      countries,
    })),
  ]);

  for (const legacy of ['source_map.csv', 'redirects.csv', 'countries.csv', 'languages.csv', 'categories.csv']) {
    await rm(join(DATA, legacy), { force: true });
  }

  process.stdout.write(
    `Stations: ${stations.length} across ${countries.length} country buckets; redirects: ${redirects.length}\n`,
  );
}

await main();
