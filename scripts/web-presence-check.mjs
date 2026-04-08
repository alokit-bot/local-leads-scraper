#!/usr/bin/env node
/**
 * web-presence-check.mjs — Pre-screening step for the SOMRAS pipeline.
 * Searches the web for a business name + location and flags any candidate
 * websites that might already belong to the business.
 *
 * Usage:
 *   node scripts/web-presence-check.mjs "Ananda Bhavan Vegetarian" "Little India, Singapore"
 *   node scripts/web-presence-check.mjs --details output/assets/ananda-bhavan-vegetarian/details.json
 *
 * Returns exit code 0 always (warning only, never blocks pipeline).
 * Prints JSON to stdout: { candidates: [...], warning: true/false }
 */

import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';

// --- Listing/aggregator domains to EXCLUDE (not owned websites) ---
const AGGREGATOR_DOMAINS = new Set([
  'google.com', 'google.co', 'google.com.sg', 'google.co.in',
  'maps.google.com', 'goo.gl',
  'facebook.com', 'fb.com', 'instagram.com',
  'twitter.com', 'x.com',
  'youtube.com', 'youtu.be',
  'yelp.com', 'yelp.co',
  'tripadvisor.com', 'tripadvisor.co',
  'zomato.com', 'swiggy.com',
  'justeat.com', 'deliveroo.com', 'ubereats.com', 'foodpanda.com', 'grabfood.com',
  'foursquare.com',
  'linkedin.com',
  'wikipedia.org', 'wikidata.org',
  'yellowpages.com', 'yellowpages.com.sg',
  'bing.com', 'duckduckgo.com',
  'reddit.com', 'quora.com',
  'pinterest.com', 'tiktok.com',
  'apple.com',  // Apple Maps
  'hungrygowhere.com', 'burpple.com', 'openrice.com',
  'timeout.com', 'thesmartlocal.com',
  'github.com', 'github.io',  // our own deployments
]);

function isAggregator(domain) {
  // Strip www. prefix
  const d = domain.replace(/^www\./, '').toLowerCase();
  // Check exact match or if it's a subdomain of an aggregator
  for (const agg of AGGREGATOR_DOMAINS) {
    if (d === agg || d.endsWith('.' + agg)) return true;
  }
  return false;
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10000,
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetch(next).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function searchGoogle(query) {
  // Use Google search and extract result URLs
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en`;
  const html = await fetch(searchUrl);

  // Extract URLs from search results
  const urls = [];
  // Google wraps result URLs in href="/url?q=<actual_url>&..."
  const re1 = /\/url\?q=(https?:\/\/[^&"]+)/g;
  let m;
  while ((m = re1.exec(html)) !== null) {
    urls.push(decodeURIComponent(m[1]));
  }

  // Also try direct href patterns
  const re2 = /href="(https?:\/\/[^"]+)"/g;
  while ((m = re2.exec(html)) !== null) {
    const u = decodeURIComponent(m[1]);
    if (!u.includes('google.com') && !urls.includes(u)) {
      urls.push(u);
    }
  }

  return urls;
}

async function searchDuckDuckGo(query) {
  // DDG HTML search — most reliable non-JS search engine
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetch(searchUrl);

  const urls = [];

  // DDG wraps result URLs in redirect: //duckduckgo.com/l/?uddg=<encoded_url>&...
  const re1 = /uddg=([^&"]+)/g;
  let m;
  while ((m = re1.exec(html)) !== null) {
    try {
      const u = decodeURIComponent(m[1]);
      if (u.startsWith('http')) urls.push(u);
    } catch {}
  }

  // Also try direct href patterns as fallback
  const re2 = /href="(https?:\/\/[^"]+)"/g;
  while ((m = re2.exec(html)) !== null) {
    const u = decodeURIComponent(m[1]);
    if (!u.includes('duckduckgo.com') && !urls.includes(u)) {
      urls.push(u);
    }
  }

  return urls;
}

function scoreCandidates(urls, businessName) {
  // Deduplicate by domain
  const seen = new Map(); // domain -> { url, score }
  const nameWords = businessName.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  for (const url of urls) {
    const domain = extractDomain(url);
    if (!domain || isAggregator(domain)) continue;
    if (seen.has(domain)) continue;

    // Score: how likely is this domain the business's own website?
    let score = 0;

    // Domain contains business name words?
    for (const word of nameWords) {
      if (domain.includes(word)) score += 2;
    }

    // Looks like a business domain (short, not a blog/news site)?
    const parts = domain.split('.');
    if (parts.length <= 3) score += 1;

    // Has common business TLDs?
    if (domain.endsWith('.com') || domain.endsWith('.sg') || domain.endsWith('.in') || domain.endsWith('.co')) {
      score += 1;
    }

    // Is it a direct domain (not a subpage of a platform)?
    const path = new URL(url).pathname;
    if (path === '/' || path === '') score += 1;

    if (score > 0) {
      seen.set(domain, { url, domain, score });
    }
  }

  // Sort by score descending
  return [...seen.values()].sort((a, b) => b.score - a.score);
}

async function main() {
  let name, area;

  // Parse args
  if (process.argv.includes('--details')) {
    const detailsPath = process.argv[process.argv.indexOf('--details') + 1];
    const details = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
    name = details.name;
    area = details.area || details.address || '';
  } else {
    name = process.argv[2];
    area = process.argv[3] || '';
  }

  if (!name) {
    console.error('Usage: node web-presence-check.mjs "Business Name" "Location"');
    console.error('   or: node web-presence-check.mjs --details path/to/details.json');
    process.exit(1);
  }

  const query = `${name} ${area} official website`;
  console.error(`🔍 Searching: "${query}"`);

  let urls = [];

  // Try Google first, fall back to DDG
  try {
    urls = await searchGoogle(query);
    console.error(`   Google: ${urls.length} raw URLs`);
  } catch (e) {
    console.error(`   Google failed (${e.message}), trying DuckDuckGo...`);
  }

  if (urls.length < 3) {
    try {
      const ddgUrls = await searchDuckDuckGo(query);
      console.error(`   DuckDuckGo: ${ddgUrls.length} raw URLs`);
      urls = [...urls, ...ddgUrls];
    } catch (e) {
      console.error(`   DuckDuckGo failed: ${e.message}`);
    }
  }

  // Score and filter
  const candidates = scoreCandidates(urls, name);

  // Output
  const result = {
    query,
    candidates: candidates.slice(0, 5).map(c => ({
      domain: c.domain,
      url: c.url,
      score: c.score,
    })),
    warning: candidates.length > 0,
  };

  // Pretty console output
  if (candidates.length > 0) {
    console.error('');
    console.error('⚠️  POSSIBLE EXISTING WEBSITES FOUND:');
    console.error('   Check if any of these belong to the business before proceeding.');
    console.error('');
    for (const c of candidates.slice(0, 5)) {
      const stars = '★'.repeat(Math.min(c.score, 5));
      console.error(`   ${stars} ${c.domain} → ${c.url}`);
    }
    console.error('');
  } else {
    console.error('✅ No existing website detected — safe to proceed.');
  }

  // JSON to stdout for pipeline consumption
  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => {
  console.error(`Error: ${e.message}`);
  // Non-blocking — always exit 0
  console.log(JSON.stringify({ query: '', candidates: [], warning: false, error: e.message }));
});
