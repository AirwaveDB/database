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
const USER_AGENT = 'AirwaveDB-database/1.0 (+https://github.com/AirwaveDB/database)';
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
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function countryCode(value) {
  const code = clean(value, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : 'ZZ';
}

function keyText(value) {
  return clean(value, 300).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function stationKey(row) {
  const cc = countryCode(row.countryCode);
  const name = keyText(row.name);
  const host = hostOf(row.homepage);
  const state = keyText(row.state);
  return `${cc}|${name}|${host || state}`;
}

function stationId(key) {
  return `awb_${createHash('sha256').update(key).digest('hex').slice(0, 20)}`;
}

function q(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function csv(headers, rows) {
  return [headers.join(','), ...rows.map((row) => headers.map((h) => q(row[h])).join(','))].join('\n') + '\n';
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
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

async function fetchWithTimeout(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res;
}

async function radioBrowser(path) {
  const errors = [];
  for (const base of MIRRORS) {
    try {
      const res = await fetchWithTimeout(base + path);
      return await res.json();
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
  try {
    const data = await (await fetchWithTimeout(VERIFIED_URL)).json();
    const out = [];
    collectVerified(data, out);
    process.stdout.write(`Verified streams: ${out.length}\n`);
    return out;
  } catch (error) {
    process.stderr.write(`Verified source unavailable: ${error.message}\n`);
    return [];
  }
}

async function previousMappings() {
  try {
    const text = await readFile(join(DATA, 'source_map.csv'), 'utf8');
    return new Map(parseCsv(text).map((r) => [`${r.source}:${r.source_id}`, r.station_id]));
  } catch {
    return new Map();
  }
}

async function previousCount() {
  try {
    const index = JSON.parse(await readFile(join(DATA, 'index.json'), 'utf8'));
    return Number(index.station_count || 0);
  } catch { return 0; }
}

function rbRow(s) {
  if (!UUID_RE.test(String(s.stationuuid ?? ''))) return null;
  const name = clean(s.name, 160);
  const stream = validUrl(s.url_resolved || s.url);
  if (!name || !stream) return null;
  const languages = clean(s.languagecodes, 200).split(',').map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z]{2,3}$/.test(x));
  const tags = clean(s.tags, 1000).split(',').map((x) => clean(x, 60).toLowerCase()).filter(Boolean).slice(0, 40);
  return {
    source: 'radio-browser', sourceId: String(s.stationuuid).toLowerCase(), name,
    countryCode: countryCode(s.countrycode), country: clean(s.country, 100), state: clean(s.state, 100),
    homepage: validUrl(s.homepage), favicon: validUrl(s.favicon), languages, tags,
    votes: Number(s.votes || 0), clicks: Number(s.clickcount || 0),
    changedAt: clean(s.changetimestamp_iso8601 || s.lastchangetime_iso8601 || '', 40),
  };
}

function verifiedRow(s) {
  const name = clean(s.name, 160);
  const sourceId = `${countryCode(s.countryCode)}:${clean(s.id, 200)}`;
  if (!name || !clean(s.id, 200)) return null;
  return {
    source: 'verified-radio-streams', sourceId, name,
    countryCode: countryCode(s.countryCode), country: clean(s.country, 100), state: clean(s.state, 100),
    homepage: validUrl(s.url), favicon: '',
    languages: Array.isArray(s.langCodes) ? s.langCodes.map((x) => clean(x, 3).toLowerCase()).filter((x) => /^[a-z]{2,3}$/.test(x)) : [],
    tags: Array.isArray(s.genre) ? s.genre.map((x) => clean(x, 60).toLowerCase()).filter(Boolean) : [],
    votes: Number(s.votes || 0), clicks: Number(s.clicks || 0), changedAt: clean(s.verified, 20),
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
  return '';
}

function newest(values) {
  return values.filter(Boolean).sort().at(-1) || '';
}

async function main() {
  const [rb, verified, previousMap, oldCount] = await Promise.all([
    fetchRadioBrowser(), fetchVerified(), previousMappings(), previousCount(),
  ]);
  const sourceRows = [...rb.map(rbRow), ...verified.map(verifiedRow)].filter(Boolean);
  const groups = new Map();
  for (const source of sourceRows) {
    const key = stationKey(source);
    if (!keyText(source.name)) continue;
    const list = groups.get(key) || [];
    list.push(source);
    groups.set(key, list);
  }

  const redirects = [];
  const sourceMapRows = [];
  const stations = [];
  for (const [key, rows] of groups) {
    const existingIds = [...new Set(rows.map((r) => previousMap.get(`${r.source}:${r.sourceId}`)).filter(Boolean))].sort();
    const id = existingIds[0] || stationId(key);
    for (const old of existingIds.slice(1)) redirects.push({ old_id: old, station_id: id });
    const ranked = [...rows].sort((a, b) => (b.votes + b.clicks) - (a.votes + a.clicks));
    const tags = [...new Set(rows.flatMap((r) => r.tags))].sort();
    const languages = [...new Set(rows.flatMap((r) => r.languages))].sort();
    const best = ranked[0];
    stations.push({
      id, name: best.name, country: best.countryCode,
      subdivision: ranked.map((r) => r.state).find(Boolean) || '',
      language_codes: languages.join(';'), categories: categoriesFor(tags).join(';'), tags: tags.join(';'),
      homepage: ranked.map((r) => r.homepage).find(Boolean) || '',
      favicon: ranked.map((r) => r.favicon).find(Boolean) || '',
      type: chooseType(tags), source_count: rows.length, updated_at: newest(rows.map((r) => r.changedAt)),
    });
    for (const r of rows) sourceMapRows.push({ source: r.source, source_id: r.sourceId, station_id: id, country: r.countryCode });
  }

  if (oldCount && stations.length < oldCount * MIN_KEEP_RATIO && !ALLOW_SHRINK) {
    throw new Error(`Station count dropped from ${oldCount} to ${stations.length}; refusing to overwrite the dataset`);
  }

  await mkdir(DATA, { recursive: true });
  await rm(STATIONS_DIR, { recursive: true, force: true });
  await mkdir(STATIONS_DIR, { recursive: true });

  const byCountry = new Map();
  for (const station of stations) {
    const list = byCountry.get(station.country) || [];
    list.push(station);
    byCountry.set(station.country, list);
  }
  const stationHeaders = ['id','name','country','subdivision','language_codes','categories','tags','homepage','favicon','type','source_count','updated_at'];
  const countries = [];
  for (const [code, rows] of [...byCountry].sort(([a], [b]) => a.localeCompare(b))) {
    rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
    await writeFile(join(STATIONS_DIR, `${code}.csv`), csv(stationHeaders, rows));
    countries.push({ code, station_count: rows.length });
  }

  sourceMapRows.sort((a,b) => a.source.localeCompare(b.source) || a.source_id.localeCompare(b.source_id));
  await writeFile(join(DATA, 'source_map.csv'), csv(['source','source_id','station_id','country'], sourceMapRows));
  if (redirects.length) {
    const unique = [...new Map(redirects.map((r) => [r.old_id, r])).values()].sort((a,b) => a.old_id.localeCompare(b.old_id));
    await writeFile(join(DATA, 'redirects.csv'), csv(['old_id','station_id'], unique));
  } else {
    await writeFile(join(DATA, 'redirects.csv'), 'old_id,station_id\n');
  }

  const languageCounts = new Map();
  const categoryCounts = new Map();
  for (const s of stations) {
    for (const code of s.language_codes.split(';').filter(Boolean)) languageCounts.set(code, (languageCounts.get(code) || 0) + 1);
    for (const id of s.categories.split(';').filter(Boolean)) categoryCounts.set(id, (categoryCounts.get(id) || 0) + 1);
  }
  await writeFile(join(DATA, 'countries.csv'), csv(['code','station_count'], countries));
  await writeFile(join(DATA, 'languages.csv'), csv(['code','station_count'], [...languageCounts].sort().map(([code, station_count]) => ({ code, station_count }))));
  await writeFile(join(DATA, 'categories.csv'), csv(['id','station_count'], [...CATEGORY_RULES.keys()].map((id) => ({ id, station_count: categoryCounts.get(id) || 0 }))));

  const index = {
    generated_at: new Date().toISOString(),
    station_count: stations.length,
    source_record_count: sourceRows.length,
    sources: { 'radio-browser': rb.length, 'verified-radio-streams': verified.length },
    countries,
  };
  await writeFile(join(DATA, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  process.stdout.write(`Stations: ${stations.length} across ${countries.length} country buckets\n`);
}

await main();
