#!/usr/bin/env node
// @ts-check
/**
 * fetch-apps.js — iMadeIt Apps build-time metadata fetcher
 * ─────────────────────────────────────────────────────────
 * Reads  : data/apps.json
 * Writes : src/data/apps-metadata.json
 *
 * Run via  npm run fetch-apps   (metadata only)
 *       or npm run build        (fetch + Astro build)
 *
 * Requires Node ≥ 18 for built-in fetch.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');

// ─── Paths ────────────────────────────────────────────────────────────────────
const APPS_INPUT  = join(ROOT, 'data', 'apps.json');
const APPS_OUTPUT = join(ROOT, 'src', 'data', 'apps-metadata.json');

// ─── Config ───────────────────────────────────────────────────────────────────
const ITUNES_BASE   = 'https://itunes.apple.com/lookup';
const COUNTRY       = 'us';
const DELAY_MS      = 650;    // polite gap between requests
const TIMEOUT_MS    = 12_000; // per-request timeout

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Extract the numeric App Store ID from any iTunes / App Store URL.
 *
 * Handles all known formats:
 *   https://apps.apple.com/app/id6756003398
 *   https://apps.apple.com/us/app/imeanit/id6756003398
 *   https://itunes.apple.com/us/app/id6756003398?mt=8
 */
function extractId(url) {
  const m = String(url || '').match(/\/id(\d{6,})/);
  return m ? m[1] : null;
}

/**
 * Return the first sentence of a description, capped at maxLen chars.
 */
function blurb(text, maxLen = 160) {
  if (!text) return '';
  const dot = text.search(/[.!?](?:\s|$)/);
  const cut = dot > 0 && dot <= maxLen
    ? text.slice(0, dot + 1)
    : text.slice(0, maxLen).trimEnd();
  return cut.length < text.length && !cut.endsWith('.')
    ? cut + '…'
    : cut;
}

/** fetch() with an AbortController timeout. */
async function timedFetch(url) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── iTunes Lookup ────────────────────────────────────────────────────────────

async function lookupApp(appId) {
  const apiUrl = `${ITUNES_BASE}?id=${appId}&country=${COUNTRY}&entity=software`;
  const res    = await timedFetch(apiUrl);

  if (!res.ok) throw new Error(`HTTP ${res.status} from iTunes API`);

  const body = await res.json();

  if (!body.resultCount) {
    throw new Error(`App ID ${appId} not found in iTunes catalogue`);
  }

  const a = body.results[0];

  return {
    id:               String(a.trackId),
    name:             a.trackName                    || '',
    subtitle:         a.subtitle                     || '',
    description:      a.description                  || '',
    shortDescription: blurb(a.description),
    icon:             a.artworkUrl512 || a.artworkUrl100 || '',
    category:         a.primaryGenreName             || '',
    genres:           a.genres                       || [],
    rating: typeof a.averageUserRating === 'number'
      ? Math.round(a.averageUserRating * 10) / 10
      : null,
    ratingCount:      a.userRatingCount              || 0,
    developer:        a.sellerName || a.artistName   || '',
    developerId:      String(a.artistId              || ''),
    url:              a.trackViewUrl                 || `https://apps.apple.com/app/id${a.trackId}`,
    price:            a.formattedPrice               || 'Free',
    currency:         a.currency                     || 'USD',
    version:          a.version                      || '',
    minimumOsVersion: a.minimumOsVersion             || '',
    supportedDevices: a.supportedDevices             || [],
    releaseDate:      a.releaseDate                  || '',
    updatedDate:      a.currentVersionReleaseDate    || '',
    screenshots:      a.screenshotUrls               || [],
    ipadScreenshots:  a.ipadScreenshotUrls           || [],
    languages:        a.languageCodesISO2A           || [],
    kind:             a.kind                         || 'software',
  };
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   iMadeIt Apps — build-time metadata fetch ║');
  console.log('╚════════════════════════════════════════════╝\n');

  // Validate input file
  if (!existsSync(APPS_INPUT)) {
    console.error(`✗  ${APPS_INPUT} not found.\n   Create data/apps.json first.`);
    process.exit(1);
  }

  let entries;
  try {
    entries = JSON.parse(readFileSync(APPS_INPUT, 'utf-8'));
  } catch (e) {
    console.error(`✗  Cannot parse apps.json: ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(entries)) {
    console.error('✗  apps.json must be a JSON array.');
    process.exit(1);
  }

  if (entries.length === 0) {
    console.warn('⚠  apps.json is empty — writing empty catalogue.\n');
    writeResult([]);
    return;
  }

  console.log(`Fetching ${entries.length} app${entries.length !== 1 ? 's' : ''}…\n`);

  const ok     = [];
  const failed = [];

  for (let i = 0; i < entries.length; i++) {
    const entry  = entries[i];
    const rawUrl = typeof entry === 'string' ? entry : entry?.url;

    // ── Missing URL ──
    if (!rawUrl) {
      failed.push({ index: i, reason: 'Entry is missing a "url" field' });
      console.log(`  [${i + 1}/${entries.length}] ⚠  Skipping entry[${i}] — no URL`);
      continue;
    }

    // ── Extract App ID ──
    const appId = extractId(rawUrl);
    if (!appId) {
      failed.push({ url: rawUrl, reason: 'Cannot extract a numeric App Store ID from URL' });
      console.log(`  [${i + 1}/${entries.length}] ⚠  Skipping — invalid URL: ${rawUrl}`);
      continue;
    }

    process.stdout.write(`  [${i + 1}/${entries.length}] id ${appId}… `);

    // ── Fetch ──
    try {
      const meta = await lookupApp(appId);
      ok.push({
        ...meta,
        featured: Boolean(entry?.featured),
        order:    typeof entry?.order === 'number' ? entry.order : i,
      });
      console.log(`✓  ${meta.name}`);
    } catch (e) {
      failed.push({ url: rawUrl, id: appId, reason: e.message });
      console.log(`✗  ${e.message}`);
    }

    // Rate-limiting pause between requests
    if (i < entries.length - 1) await sleep(DELAY_MS);
  }

  // Sort: featured first, then by original order, then alphabetically
  ok.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    if (a.order    !== b.order)    return a.order - b.order;
    return a.name.localeCompare(b.name);
  });

  writeResult(ok);

  // ── Summary ──
  console.log(`\n✔  ${ok.length} app${ok.length !== 1 ? 's' : ''} written to src/data/apps-metadata.json`);

  if (failed.length > 0) {
    console.warn(`\n⚠  ${failed.length} entr${failed.length === 1 ? 'y' : 'ies'} could not be fetched:`);
    for (const f of failed) {
      const loc = f.url ? f.url : `entry[${f.index}]`;
      console.warn(`   • ${loc}\n     Reason: ${f.reason}`);
    }
    console.warn('\n   The site will build without these apps. Fix the URLs and rebuild.\n');
    // Exit 1 only when every single app failed — partial success is still a build
    if (ok.length === 0) {
      console.error('✗  No apps fetched successfully — aborting build.');
      process.exit(1);
    }
  }

  console.log('');
}

function writeResult(data) {
  const dir = dirname(APPS_OUTPUT);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(APPS_OUTPUT, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

main().catch((e) => {
  console.error(`\n💥  Fatal error: ${e.stack || e.message}`);
  process.exit(1);
});
