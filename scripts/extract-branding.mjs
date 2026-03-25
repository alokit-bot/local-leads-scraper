#!/usr/bin/env node
/**
 * extract-branding.mjs — Extract logo description + brand colors from Google Maps photos
 * 
 * Usage:
 *   node scripts/extract-branding.mjs --slug ananda-bhavan-vegetarian --maps-url "https://maps.app.goo.gl/..."
 *   node scripts/extract-branding.mjs --slug envoq-salon-jayanagar --details output/assets/envoq-salon-jayanagar/details.json
 * 
 * Outputs: output/assets/<slug>/branding.json
 * {
 *   "logo": { "description": "...", "textContent": "...", "fontStyle": "...", "colors": [...] },
 *   "palette": { "primary": "#...", "secondary": "#...", "accent": "#...", "background": "#..." },
 *   "photos": ["path1.jpg", "path2.jpg"],
 *   "promptSnippet": "..."  // Ready to paste into Emergent prompt
 * }
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_ROOT = path.join(__dirname, '..', 'output', 'assets');

// ─── Argument parsing ────────────────────────────────────────────────────────
function getFlag(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

const slug = getFlag('--slug');
const mapsUrl = getFlag('--maps-url');
const detailsPath = getFlag('--details');

if (!slug) {
  console.error('Usage: node extract-branding.mjs --slug <slug> [--maps-url <url>] [--details <path>]');
  process.exit(1);
}

const assetDir = path.join(ASSETS_ROOT, slug);
fs.mkdirSync(assetDir, { recursive: true });

// Load details if available
let details = {};
const autoDetailsPath = detailsPath || path.join(assetDir, 'details.json');
if (fs.existsSync(autoDetailsPath)) {
  details = JSON.parse(fs.readFileSync(autoDetailsPath, 'utf8'));
}

const businessName = details.name || slug.replace(/-/g, ' ');

// ─── Photo capture via Google Maps ───────────────────────────────────────────
//
// This script is designed to be called from a context where browser automation
// is available (e.g., the OpenClaw agent). It can also work with pre-downloaded
// photos placed in the asset directory.
//
// For automated use: the pipeline orchestrator (or agent) should:
//   1. Navigate to Google Maps photos for the business
//   2. Screenshot 2-3 photos (storefront, entrance, menu card)
//   3. Save them as: <assetDir>/photo-storefront.jpg, photo-entrance.jpg, etc.
//   4. Then run this script to analyze them
//
// For manual use: place photos in the asset dir and run this script.

function findPhotos() {
  const photos = [];
  if (!fs.existsSync(assetDir)) return photos;
  
  const files = fs.readdirSync(assetDir);
  for (const f of files) {
    if (/\.(jpg|jpeg|png|webp)$/i.test(f)) {
      photos.push(path.join(assetDir, f));
    }
  }
  return photos;
}

// ─── Vision analysis ─────────────────────────────────────────────────────────

function analyzeWithVision(imagePaths) {
  // Build a prompt for the vision model
  const prompt = `You are analyzing photos of a business called "${businessName}" to extract branding information.

Look at these photos (likely storefront, entrance, signage, or menu cards) and extract:

1. **LOGO DESCRIPTION**: Describe the business logo in detail:
   - What text appears in the logo? (exact text)
   - What font style? (serif, sans-serif, script, decorative, etc.)
   - What colors are used in the logo?
   - What is the layout? (text only, text + icon, icon only, etc.)
   - Any symbols, icons, or decorative elements?

2. **BRAND COLORS**: Identify the brand's color palette from the storefront/signage:
   - Primary color (the dominant brand color)
   - Secondary color
   - Accent color (if any)
   - Background tone (light/dark, warm/cool)
   Give exact hex codes where possible, or close approximations.

3. **BRAND VIBE**: In 2-3 words, describe the overall aesthetic (e.g., "modern minimalist", "traditional ornate", "rustic warm", "vibrant playful")

Respond in this exact JSON format (no markdown, just JSON):
{
  "logo": {
    "textContent": "exact text in the logo",
    "fontStyle": "description of font style",
    "colors": ["#hex1", "#hex2"],
    "layout": "text-only | text-icon | icon-only",
    "description": "full natural language description of the logo",
    "iconDescription": "description of any icon/symbol, or null"
  },
  "palette": {
    "primary": "#hexcode",
    "secondary": "#hexcode",
    "accent": "#hexcode",
    "background": "#hexcode",
    "text": "#hexcode"
  },
  "brandVibe": "2-3 word aesthetic description",
  "storeFrontDescription": "brief description of what the storefront looks like"
}`;

  // Write prompt to temp file for the vision analysis
  const tempPrompt = path.join(assetDir, '.vision-prompt.txt');
  fs.writeFileSync(tempPrompt, prompt);
  
  // Return the prompt and image paths for the caller to use with their vision tool
  return { prompt, imagePaths };
}

// ─── Generate prompt snippet ─────────────────────────────────────────────────

function generatePromptSnippet(branding) {
  const { logo, palette, brandVibe } = branding;
  
  let snippet = `## BRANDING (extracted from real business photos)\n\n`;
  
  if (logo) {
    snippet += `### Logo\n`;
    snippet += `- Text: "${logo.textContent}"\n`;
    snippet += `- Font style: ${logo.fontStyle}\n`;
    snippet += `- Layout: ${logo.layout}\n`;
    if (logo.iconDescription) {
      snippet += `- Icon/symbol: ${logo.iconDescription}\n`;
    }
    snippet += `- Full description: ${logo.description}\n`;
    snippet += `\n**IMPORTANT:** Recreate this logo as closely as possible using CSS/SVG text styling. Match the font style, colors, and layout described above. Do NOT use a generic placeholder — this is the real business logo.\n\n`;
  }
  
  if (palette) {
    snippet += `### Color Palette (use these as the website theme)\n`;
    snippet += `- Primary: ${palette.primary}\n`;
    snippet += `- Secondary: ${palette.secondary}\n`;
    snippet += `- Accent: ${palette.accent}\n`;
    snippet += `- Background: ${palette.background}\n`;
    if (palette.text) snippet += `- Text: ${palette.text}\n`;
    snippet += `\n`;
  }
  
  if (brandVibe) {
    snippet += `### Brand Vibe: ${brandVibe}\n`;
    snippet += `Design the entire website to match this aesthetic. The website should feel like a natural extension of walking into this business.\n`;
  }
  
  return snippet;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.error(`🎨 Extracting branding for: ${businessName}`);
  
  const photos = findPhotos();
  
  if (photos.length === 0) {
    console.error('⚠️  No photos found in asset directory.');
    console.error(`   Place storefront/entrance photos in: ${assetDir}`);
    console.error('   Supported formats: .jpg, .jpeg, .png, .webp');
    console.error('');
    console.error('   The pipeline orchestrator should capture these from Google Maps before running this script.');
    
    // Output empty branding
    const emptyResult = {
      logo: null,
      palette: null,
      brandVibe: null,
      photos: [],
      promptSnippet: '',
      status: 'no-photos'
    };
    
    const outPath = path.join(assetDir, 'branding.json');
    fs.writeFileSync(outPath, JSON.stringify(emptyResult, null, 2));
    console.log(JSON.stringify(emptyResult, null, 2));
    return;
  }
  
  console.error(`📸 Found ${photos.length} photo(s):`);
  for (const p of photos) {
    console.error(`   → ${path.basename(p)}`);
  }
  
  // Generate the vision analysis request
  const analysis = analyzeWithVision(photos);
  
  // Output the analysis request — the calling agent will run the vision model
  // and then call this script again with --branding-json to finalize
  const brandingJsonPath = path.join(assetDir, 'branding-raw.json');
  
  if (getFlag('--branding-json')) {
    // Phase 2: Vision response provided, generate final output
    const rawBranding = JSON.parse(fs.readFileSync(getFlag('--branding-json'), 'utf8'));
    const promptSnippet = generatePromptSnippet(rawBranding);
    
    const finalResult = {
      ...rawBranding,
      photos: photos.map(p => path.basename(p)),
      promptSnippet,
      status: 'complete'
    };
    
    const outPath = path.join(assetDir, 'branding.json');
    fs.writeFileSync(outPath, JSON.stringify(finalResult, null, 2));
    console.error(`✅ Branding saved to: ${outPath}`);
    console.log(JSON.stringify(finalResult, null, 2));
  } else {
    // Phase 1: Output the vision prompt for the agent to run
    const request = {
      status: 'needs-vision',
      prompt: analysis.prompt,
      imagePaths: analysis.imagePaths,
      instructions: 'Run this prompt against the listed images using a vision model, save the JSON response to branding-raw.json, then re-run with --branding-json branding-raw.json'
    };
    
    const outPath = path.join(assetDir, 'vision-request.json');
    fs.writeFileSync(outPath, JSON.stringify(request, null, 2));
    console.error(`\n📋 Vision analysis needed. Request saved to: ${outPath}`);
    console.error(`   Run the vision model with the prompt and ${photos.length} image(s),`);
    console.error(`   then re-run: node extract-branding.mjs --slug ${slug} --branding-json ${path.join(assetDir, 'branding-raw.json')}`);
    console.log(JSON.stringify(request, null, 2));
  }
}

main().catch(e => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
