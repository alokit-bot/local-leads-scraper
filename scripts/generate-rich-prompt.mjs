#!/usr/bin/env node
/**
 * generate-rich-prompt.mjs — Generate a rich, personalized Emergent prompt
 * 
 * Combines:
 * - Base prompt template
 * - details.json (Google Places data)
 * - enriched-data.json (Zomato/web scraping)
 * - prompt-enrichment.md (formatted enrichment)
 * - branding.json (if available)
 *
 * Usage: node scripts/generate-rich-prompt.mjs --slug somras-bar-kitchen
 * Output: output/assets/<slug>/prompt.md (overwrites)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_ROOT = path.join(__dirname, '..', 'output', 'assets');

function getFlag(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

const slug = getFlag('--slug');
if (!slug) {
  console.error('Usage: node generate-rich-prompt.mjs --slug <slug>');
  process.exit(1);
}

const assetDir = path.join(ASSETS_ROOT, slug);

// Load all available data
function loadJson(filename) {
  const p = path.join(assetDir, filename);
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  }
  return null;
}

function loadText(filename) {
  const p = path.join(assetDir, filename);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

const details = loadJson('details.json') || {};
const enriched = loadJson('enriched-data.json') || {};
const branding = loadJson('branding.json');
const enrichmentMd = loadText('prompt-enrichment.md');
const existingPrompt = loadText('prompt.md');

// If we already have a prompt with enrichment, skip
if (existingPrompt && existingPrompt.includes('═══ ENRICHED DATA')) {
  console.log('Prompt already has enrichment data. Skipping.');
  process.exit(0);
}

// If we have a prompt but no enrichment, append enrichment
if (existingPrompt && enrichmentMd) {
  const enrichedPrompt = existingPrompt + '\n' + enrichmentMd;
  fs.writeFileSync(path.join(assetDir, 'prompt.md'), enrichedPrompt);
  console.log(`✅ Appended enrichment to existing prompt (${enrichmentMd.length} chars)`);
  process.exit(0);
}

// If no prompt exists, generate one from scratch
const name = details.name || enriched.name || slug.replace(/-/g, ' ');
const rating = details.rating || enriched.rating || '?';
const reviews = details.reviewCount || details.reviews?.length || enriched.reviews?.length || '?';
const phone = details.internationalPhoneNumber || details.phone || '?';
const address = details.formattedAddress || details.address || enriched.area || '?';
const category = details.primaryTypeDisplayName?.text || details.category || 'Business';
const hours = details.regularOpeningHours?.weekdayDescriptions?.join(', ') || enriched.hours?.join(', ') || 'Open daily';

let prompt = `# ${name} — Website Prompt

## BUSINESS_FACTS
- Name: **${name}**
- Location: ${address}
- Phone: ${phone}
- Rating: ${rating}★ on Google Maps (${reviews}+ reviews)
- Category: ${category}
- Hours: ${hours}

## SECTIONS
1. **Header** — "${name}" logo text, professional navigation
2. **Hero** — Compelling headline, ${rating}★ rating badge, CTA buttons (tel: link for phone)
3. **About** — Business story, what makes them special, years of service
4. **Services/Menu** — Core offerings with ₹ pricing where available
5. **Gallery** — Beautiful placeholder images matching the business type
6. **Testimonials** — Customer reviews (use real reviews if provided below)
7. **Contact** — Phone (tel: link), address, Google Maps link, hours
8. **Footer** — Quick links, contact info, copyright

## DESIGN_DIRECTION
- Professional, modern, mobile-first
- Color palette should match the business type and vibe
- Use lucide-react icons, smooth scroll navigation
- Responsive at 375px, 768px, 1440px, 1920px

## IMPORTANT INSTRUCTIONS
- **DO NOT ask clarifying questions.** Proceed immediately with your best judgment.
- Frontend-only — no backend, no database, no server-side logic.
- Use direct tel: links for phone calls and Google Maps links for directions.
- Use INR (₹) for any pricing references.
- Build everything in one go — no partial builds.
`;

// Add branding if available
if (branding && branding.promptSnippet) {
  prompt += '\n' + branding.promptSnippet;
}

// Add enrichment data
if (enrichmentMd) {
  prompt += '\n' + enrichmentMd;
}

fs.writeFileSync(path.join(assetDir, 'prompt.md'), prompt);
console.log(`✅ Generated rich prompt for ${name} (${prompt.length} chars)`);
