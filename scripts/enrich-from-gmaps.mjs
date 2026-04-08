#!/usr/bin/env node
/**
 * enrich-from-gmaps.mjs — Extract rich business data from Google Maps
 * 
 * This script uses the Google Maps "place details" embedded in search results
 * (via SerpAPI-style scraping) to get reviews, hours, services, etc.
 * 
 * It works WITHOUT browser automation by scraping Google's text search results
 * and structured data from various aggregator sites.
 *
 * Usage:
 *   node scripts/enrich-from-gmaps.mjs --name "SOMRAS BAR & KITCHEN" --area "HSR Layout, Bengaluru" --slug somras-bar-kitchen
 *
 * Output: output/assets/<slug>/enriched-data.json
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_ROOT = path.join(__dirname, '..', 'output', 'assets');

function getFlag(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function curlFetch(url, timeout = 15000) {
  try {
    return execSync(
      `curl -sL "${url}" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --max-time ${Math.floor(timeout/1000)}`,
      { encoding: 'utf8', timeout: timeout + 2000 }
    );
  } catch (e) {
    return '';
  }
}

function extractDDGUrls(html) {
  const urls = [];
  const re = /uddg=([^&"]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { urls.push(decodeURIComponent(m[1])); } catch {}
  }
  return urls;
}

async function enrichBusiness(name, area, slug) {
  const result = {
    name,
    area,
    slug,
    reviews: [],
    menuHighlights: [],
    services: [],
    highlights: [],
    hours: null,
    about: null,
    priceRange: null,
    yearsInBusiness: null,
    scrapedAt: new Date().toISOString(),
  };

  // 1. Scrape reviews from JustDial/aggregator pages
  console.error('  Fetching reviews from aggregators...');
  const reviewQuery = encodeURIComponent(`"${name}" ${area} reviews`);
  const reviewHtml = curlFetch(`https://html.duckduckgo.com/html/?q=${reviewQuery}`);
  const reviewUrls = extractDDGUrls(reviewHtml);
  
  // Try to find JustDial, Google, or review aggregator pages
  for (const url of reviewUrls.slice(0, 5)) {
    if (url.includes('justdial.com') || url.includes('tripadvisor') || url.includes('zomato.com')) {
      try {
        const page = curlFetch(url);
        // Extract review-like text snippets
        const reviewTexts = page.match(/"reviewBody"\s*:\s*"([^"]{30,300})"/g) || [];
        for (const rt of reviewTexts.slice(0, 5)) {
          const text = rt.match(/"reviewBody"\s*:\s*"([^"]+)"/)?.[1];
          if (text) result.reviews.push({ text, source: new URL(url).hostname });
        }
        
        // Extract structured data
        const ratingMatch = page.match(/"ratingValue"\s*:\s*"?(\d+\.?\d*)"?/);
        if (ratingMatch) result.rating = parseFloat(ratingMatch[1]);
        
        const priceMatch = page.match(/"priceRange"\s*:\s*"([^"]+)"/);
        if (priceMatch) result.priceRange = priceMatch[1];
      } catch (e) {}
    }
  }

  // 2. Scrape menu/services info
  console.error('  Fetching menu and services...');
  const menuQuery = encodeURIComponent(`"${name}" ${area} menu prices`);
  const menuHtml = curlFetch(`https://html.duckduckgo.com/html/?q=${menuQuery}`);
  
  // Extract snippets that mention prices
  const snippetRe = /class="result__snippet"[^>]*>(.*?)<\/a>/gs;
  let m;
  while ((m = snippetRe.exec(menuHtml)) !== null) {
    const text = m[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim();
    if (text.includes('₹') || text.includes('Rs') || text.includes('INR') || text.includes('menu')) {
      result.menuHighlights.push(text.slice(0, 200));
    }
  }

  // 3. Try to get Zomato page for menu details
  const zomatoQuery = encodeURIComponent(`${name} ${area} site:zomato.com`);
  const zomatoHtml = curlFetch(`https://html.duckduckgo.com/html/?q=${zomatoQuery}`);
  const zomatoUrls = extractDDGUrls(zomatoHtml).filter(u => u.includes('zomato.com'));
  
  if (zomatoUrls.length > 0) {
    try {
      const zPage = curlFetch(zomatoUrls[0]);
      // Extract cuisine types
      const cuisineMatch = zPage.match(/Cuisines?\s*[:\-]\s*([^<\n]{5,100})/i);
      if (cuisineMatch) result.cuisines = cuisineMatch[1].trim();
      
      // Extract cost info
      const costMatch = zPage.match(/₹\s*(\d[\d,]+)\s*(?:for two|per person)/i);
      if (costMatch) result.priceRange = `₹${costMatch[1]} for two`;
    } catch (e) {}
    result._zomatoUrl = zomatoUrls[0];
  }

  // 4. Get Google snippet data (knowledge panel info)
  console.error('  Fetching Google knowledge panel...');
  const gQuery = encodeURIComponent(`${name} ${area}`);
  const gHtml = curlFetch(`https://html.duckduckgo.com/html/?q=${gQuery}`);
  
  // Extract business description from DuckDuckGo instant answer
  const abstractRe = /class="result__snippet"[^>]*>(.*?)<\/a>/s;
  const abstractMatch = abstractRe.exec(gHtml);
  if (abstractMatch) {
    const abstract = abstractMatch[1].replace(/<[^>]*>/g, '').trim();
    if (abstract.length > 50 && !result.about) {
      result.about = abstract;
    }
  }

  return result;
}

/**
 * Generate a rich prompt section from enriched data.
 * This is what gets injected into the Emergent prompt to make builds personalized.
 */
function generatePromptEnrichment(data) {
  let enrichment = '';
  
  if (data.reviews && data.reviews.length > 0) {
    enrichment += '\n## REAL_CUSTOMER_REVIEWS (scraped from the web)\n';
    enrichment += 'Use these exact quotes as testimonials on the website:\n';
    for (const r of data.reviews.slice(0, 5)) {
      enrichment += `\n> "${r.text}"\n> — ${r.authorName || 'Customer'} ${r.rating ? `(${r.rating}★)` : ''}\n`;
    }
  }

  if (data.menuHighlights && data.menuHighlights.length > 0) {
    enrichment += '\n## MENU_INFO (from web sources)\n';
    enrichment += 'Use this information to create realistic menu items with actual pricing:\n';
    for (const h of data.menuHighlights.slice(0, 5)) {
      enrichment += `- ${h}\n`;
    }
  }

  if (data.cuisines) {
    enrichment += `\n## CUISINES: ${data.cuisines}\n`;
  }

  if (data.priceRange) {
    enrichment += `## PRICE_RANGE: ${data.priceRange}\n`;
  }

  if (data.about) {
    enrichment += `\n## ABOUT (from web)\n${data.about}\n`;
  }

  if (enrichment) {
    enrichment = '\n# ═══ ENRICHED DATA (real business information) ═══' + enrichment;
    enrichment += '\n**Use this real data to make the website feel authentic and personalized. Do NOT use generic placeholder text when real data is available above.**\n';
  }

  return enrichment;
}

async function main() {
  const name = getFlag('--name');
  const area = getFlag('--area') || '';
  const slug = getFlag('--slug') || name?.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  if (!name) {
    console.error('Usage: node enrich-from-gmaps.mjs --name "Business Name" --area "Location" [--slug slug]');
    process.exit(1);
  }

  console.error(`🔍 Enriching: ${name} (${area})`);
  
  const data = await enrichBusiness(name, area, slug);
  
  // Save enriched data
  const outDir = path.join(ASSETS_ROOT, slug);
  fs.mkdirSync(outDir, { recursive: true });
  
  fs.writeFileSync(
    path.join(outDir, 'enriched-data.json'),
    JSON.stringify(data, null, 2)
  );

  // Generate and save prompt enrichment
  const enrichment = generatePromptEnrichment(data);
  if (enrichment) {
    fs.writeFileSync(
      path.join(outDir, 'prompt-enrichment.md'),
      enrichment
    );
    console.error(`✅ Enrichment saved (${data.reviews.length} reviews, ${data.menuHighlights.length} menu items)`);
  } else {
    console.error('⚠️  No enrichment data found — prompt will use template data only');
  }

  // Output stats
  console.log(JSON.stringify({
    reviews: data.reviews.length,
    menuHighlights: data.menuHighlights.length,
    hasAbout: !!data.about,
    hasPriceRange: !!data.priceRange,
    hasCuisines: !!data.cuisines,
    enrichmentLength: enrichment.length,
  }));
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});

export { enrichBusiness, generatePromptEnrichment };
