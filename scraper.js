#!/usr/bin/env node
/**
 * Local Leads Scraper
 * Finds high-rated businesses without websites — lead gen for web dev outreach.
 *
 * Usage:
 *   node scraper.js [options]
 *   node scraper.js --help
 */

'use strict';

const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultVal;
}
function hasFlag(flag) { return args.includes(flag); }

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`
Usage: node scraper.js [options]

Options:
  --rating <num>       Minimum rating (default: from config.json or 4.0)
  --reviews <num>      Minimum review count (default: from config.json or 200)
  --areas <a,b,c>      Comma-separated areas to search
  --categories <a,b>   Comma-separated categories to search
  --output <file>      Output CSV filename (default: leads_YYYY-MM-DD.csv)
  --cdp-port <port>    Chrome CDP port (default: 9222 or config.json value)
  --headless           Launch Chrome in headless mode automatically
  --config <file>      Path to config JSON (default: ./config.json)
  --help               Show this help
`);
  process.exit(0);
}

// ── Config ────────────────────────────────────────────────────────────────────
const configPath = getArg('--config', path.join(__dirname, 'config.json'));
let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.warn('No config.json found, using defaults.');
}

const MIN_RATING  = parseFloat(getArg('--rating',  config.minRating  ?? 4.0));
const MIN_REVIEWS = parseInt(getArg('--reviews', config.minReviews ?? 200));
const CDP_PORT    = parseInt(getArg('--cdp-port', config.cdpPort ?? 9222));
const PAGE_WAIT   = config.pageLoadWaitMs ?? 3500;
const OUTPUT_DIR  = config.outputDir ?? './output';

const today = new Date().toISOString().slice(0, 10);
const OUTPUT_CSV  = getArg('--output', path.join(OUTPUT_DIR, `leads_${today}.csv`));
const OUTPUT_JSON = OUTPUT_CSV.replace(/\.csv$/, '.json');

const AREAS = getArg('--areas', null)?.split(',').map(s => s.trim())
  ?? config.areas
  ?? ['HSR Layout', 'Koramangala', 'BTM Layout', 'Jayanagar'];

const CATEGORIES = getArg('--categories', null)?.split(',').map(s => s.trim())
  ?? config.categories
  ?? ['restaurants', 'salons'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseReviewCount(raw) {
  if (!raw) return 0;
  raw = raw.replace(/,/g, '');
  if (raw.toUpperCase().includes('K')) return Math.round(parseFloat(raw) * 1000);
  if (raw.toUpperCase().includes('M')) return Math.round(parseFloat(raw) * 1_000_000);
  return parseInt(raw) || 0;
}

function extractBusinesses(pageText, area, category) {
  const lines = pageText.split('\n').filter(l => l.trim());
  const items = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d\.\d)\((\d+\.?\d*[KM]?)\)/i);
    if (!m) continue;
    const name = lines[i - 1]?.trim();
    if (!name || name.length < 3 || seen.has(name)) continue;
    const rating  = parseFloat(m[1]);
    const reviews = parseReviewCount(m[2]);
    if (rating < MIN_RATING || reviews < MIN_REVIEWS) continue;
    const rest = lines[i].slice(m[0].length);
    const cat  = rest.replace(/^\s*[·•]?\s*\$+\s*[·•]?\s*/, '').split('·')[0].trim();
    const addr = lines[i + 1]?.trim() || '';
    seen.add(name);
    items.push({ name, rating, reviews, category: cat || category, area, addr });
  }
  return items;
}

async function checkWebsite(Runtime, Page, business) {
  const query = encodeURIComponent(`${business.name} ${business.addr.split(',')[0]} Bengaluru`);
  await Page.navigate({ url: `https://www.google.com/maps/search/${query}` });
  await sleep(PAGE_WAIT);

  // Pull external links (non-Google)
  const { result: linkRes } = await Runtime.evaluate({
    expression: `JSON.stringify(
      [...document.querySelectorAll('a[href]')]
        .map(a => a.href)
        .filter(h => h && h.startsWith('http') && !h.includes('google.com') && !h.includes('accounts.'))
        .slice(0, 5)
    )`
  });
  let links = [];
  try { links = JSON.parse(linkRes.value || '[]'); } catch (_) {}

  // Pull phone
  const { result: textRes } = await Runtime.evaluate({ expression: 'document.body.innerText' });
  const text = textRes.value || '';
  const phoneMatch = text.match(/\+91[\s\-]?[\d\s\-]{10,13}/);
  const phone = phoneMatch ? phoneMatch[0].replace(/\s+/g, ' ').trim() : '';

  // Build Maps URL from current page
  const { result: urlRes } = await Runtime.evaluate({ expression: 'location.href' });
  const mapsUrl = urlRes.value || '';

  const hasWebsite = links.length > 0;
  return { hasWebsite, websiteUrl: links[0] || '', phone, mapsUrl };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) { process.stderr.write(msg + '\n'); }

// ── Chrome launcher (optional) ────────────────────────────────────────────────
let chromePid = null;
let xvfbPid   = null;

async function launchChrome(port) {
  // Try to start Xvfb if on Linux and no DISPLAY
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    log('Starting Xvfb...');
    const xvfb = spawn('Xvfb', [':99', '-screen', '0', '1280x720x24'], { detached: true, stdio: 'ignore' });
    xvfbPid = xvfb.pid;
    process.env.DISPLAY = ':99';
    await sleep(1000);
  }

  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('Chromium/Chrome not found. Install it first.');

  log(`Launching ${chromeBin} on port ${port}...`);
  const chrome = spawn(chromeBin, [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--headless=new',
    '--user-data-dir=/tmp/local-leads-chrome',
    'about:blank',
  ], { detached: true, stdio: 'ignore' });
  chromePid = chrome.pid;
  await sleep(2500);
}

function findChrome() {
  const candidates = [
    'google-chrome', 'google-chrome-stable',
    'chromium-browser', 'chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const c of candidates) {
    try { execSync(`which ${c}`, { stdio: 'ignore' }); return c; } catch (_) {}
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function cleanup() {
  if (chromePid) try { process.kill(chromePid); } catch (_) {}
  if (xvfbPid)   try { process.kill(xvfbPid); }   catch (_) {}
}

// ── CSV writer ────────────────────────────────────────────────────────────────
function toCSV(rows) {
  const header = ['Name', 'Rating', 'Reviews', 'Category', 'Area', 'Address', 'Phone', 'Maps URL'];
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header.map(escape).join(',')];
  for (const r of rows) {
    lines.push([r.name, r.rating, r.reviews, r.category, r.area, r.addr, r.phone, r.mapsUrl].map(escape).join(','));
  }
  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Check if Chrome is already running on CDP_PORT
  let cdpReachable = false;
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).catch(() => null);
    cdpReachable = res?.ok;
  } catch (_) {}

  if (!cdpReachable || hasFlag('--headless')) {
    log('Chrome not detected on port ' + CDP_PORT + ', launching...');
    await launchChrome(CDP_PORT);
  } else {
    log('Using existing Chrome on port ' + CDP_PORT);
  }

  const client = await CDP({ port: CDP_PORT });
  const { Page, Runtime } = client;
  await Page.enable();

  log(`\nConfig: rating ≥ ${MIN_RATING}, reviews ≥ ${MIN_REVIEWS}`);
  log(`Areas (${AREAS.length}): ${AREAS.join(', ')}`);
  log(`Categories (${CATEGORIES.length}): ${CATEGORIES.join(', ')}`);
  log(`Searches to run: ${AREAS.length * CATEGORIES.length}\n`);

  // ── Phase 1: Collect candidates ──
  const allBusinesses = [];
  const seen = new Set();

  for (const area of AREAS) {
    for (const cat of CATEGORIES) {
      const q = encodeURIComponent(`${cat} near ${area} Bengaluru`);
      log(`Searching: ${cat} in ${area}`);

      await Page.navigate({ url: `https://www.google.com/search?q=${q}&udm=1&num=20` });
      await sleep(PAGE_WAIT);

      const { result } = await Runtime.evaluate({ expression: 'document.body.innerText' });
      const items = extractBusinesses(result.value || '', area, cat);

      // Scroll for more results
      await Runtime.evaluate({ expression: 'window.scrollTo(0, 3000)' });
      await sleep(1500);
      const { result: r2 } = await Runtime.evaluate({ expression: 'document.body.innerText' });
      const more = extractBusinesses(r2.value || '', area, cat);

      const combined = [...items, ...more].filter(b => {
        if (seen.has(b.name)) return false;
        seen.add(b.name);
        return true;
      });

      allBusinesses.push(...combined);
      log(`  → ${combined.length} qualifying (${allBusinesses.length} total)`);
    }
  }

  log(`\n✅ Phase 1 done. ${allBusinesses.length} unique businesses to check.\n`);

  // ── Phase 2: Check websites ──
  const leads     = [];
  const hasWebsiteList = [];

  for (let i = 0; i < allBusinesses.length; i++) {
    const biz = allBusinesses[i];
    process.stderr.write(`[${i + 1}/${allBusinesses.length}] ${biz.name} ...`);

    try {
      const info = await checkWebsite(Runtime, Page, biz);
      const full = { ...biz, ...info };

      if (!info.hasWebsite) {
        leads.push(full);
        process.stderr.write(` ✅ LEAD (no website)\n`);
      } else {
        hasWebsiteList.push(full);
        process.stderr.write(` — has website\n`);
      }
    } catch (e) {
      process.stderr.write(` ⚠️  error: ${e.message}\n`);
    }

    // Save progress every 20
    if ((i + 1) % 20 === 0) {
      const progress = { leads, hasWebsite: hasWebsiteList, processed: i + 1, total: allBusinesses.length };
      fs.writeFileSync(OUTPUT_JSON.replace('.json', '_progress.json'), JSON.stringify(progress, null, 2));
    }
  }

  // ── Output ──
  const output = {
    generatedAt: new Date().toISOString(),
    config: { minRating: MIN_RATING, minReviews: MIN_REVIEWS, areas: AREAS, categories: CATEGORIES },
    summary: { totalChecked: allBusinesses.length, leads: leads.length, hasWebsite: hasWebsiteList.length },
    leads,
    hasWebsite: hasWebsiteList,
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2));
  fs.writeFileSync(OUTPUT_CSV, toCSV(leads));

  log(`\n${'─'.repeat(60)}`);
  log(`✅ Done!`);
  log(`   Leads (no website): ${leads.length}`);
  log(`   Has website:        ${hasWebsiteList.length}`);
  log(`   CSV:  ${OUTPUT_CSV}`);
  log(`   JSON: ${OUTPUT_JSON}`);
  log(`${'─'.repeat(60)}\n`);

  await client.close();
  cleanup();
})().catch(e => {
  console.error('Fatal error:', e.message);
  cleanup();
  process.exit(1);
});
