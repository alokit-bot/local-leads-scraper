#!/usr/bin/env node
/**
 * pipeline.mjs — Full Pipeline Orchestrator
 *
 * Runs the complete flow: fetch assets → generate prompt → build → screenshot → deploy
 *
 * Usage:
 *   node scripts/pipeline.mjs --slug envoq-salon-jayanagar
 *   node scripts/pipeline.mjs --from-leads --count 3
 *   node scripts/pipeline.mjs --slug envoq-salon-jayanagar --step build
 *   node scripts/pipeline.mjs --slug envoq-salon-jayanagar --step deploy --repo-url https://github.com/alokit-bot/website-envoq-salon-jayanagar
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const LEADS_PATH = path.join(PROJECT_ROOT, 'output', 'lead_shortlist.md');
const ASSETS_ROOT = path.join(PROJECT_ROOT, 'output', 'assets');

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getFlag(flag, fallback = null) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : fallback;
}
function hasFlag(flag) { return args.includes(flag); }

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`
Usage:
  node scripts/pipeline.mjs [options]

Options:
  --slug <slug>           Run pipeline for a specific business slug
  --from-leads            Pick businesses from lead_shortlist.md
  --count <n>             How many leads to process (default: 1, with --from-leads)
  --step <step>           Run only one step: fetch | prompt | build | deploy | all (default: all)
  --no-fetch              Skip asset fetching (use existing assets)
  --no-github             Skip GitHub persist
  --no-deploy             Skip GitHub Pages deployment
  --repo-url <url>        GitHub repo URL for deploy step
  --name <name>           Business name (required if --slug without details.json)
  --area <area>           Business area (e.g. Jayanagar)
  --phone <phone>         Business phone number
  --rating <n>            Business rating
  --reviews <n>           Number of Google reviews
`);
  process.exit(0);
}

const slug = getFlag('--slug');
const fromLeads = hasFlag('--from-leads');
const count = parseInt(getFlag('--count', '1'), 10);
const step = getFlag('--step', 'all');
const noFetch = hasFlag('--no-fetch');
const noGithub = hasFlag('--no-github');
const noDeploy = hasFlag('--no-deploy');
const repoUrl = getFlag('--repo-url');

if (!slug && !fromLeads) {
  console.error('Error: --slug or --from-leads is required');
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('\n🚀 Pipeline Orchestrator — Emergent.sh Website Builder\n');

  const slugsToProcess = [];

  if (slug) {
    slugsToProcess.push({
      slug,
      name: getFlag('--name') || slug,
      area: getFlag('--area') || '',
      phone: getFlag('--phone') || '',
      rating: getFlag('--rating') || '',
      reviewCount: getFlag('--reviews') || '',
    });
  } else if (fromLeads) {
    const leads = parseLeadsFile(LEADS_PATH);
    const pending = leads.filter(l => !hasExistingBuild(l.slug)).slice(0, count);
    if (pending.length === 0) {
      log('✅ No pending leads found (all have existing builds or shortlist is empty)');
      return;
    }
    log(`📋 Found ${pending.length} leads to process`);
    for (const lead of pending) {
      log(`   → ${lead.name} (${lead.slug})`);
      slugsToProcess.push(lead);
    }
  }

  const results = [];
  for (const business of slugsToProcess) {
    log(`\n${'─'.repeat(60)}`);
    log(`Processing: ${business.name} (${business.slug})`);
    log('─'.repeat(60));

    try {
      const result = await runPipeline(business, step);
      results.push({ ...business, ...result, success: true });
    } catch (err) {
      log(`\n❌ Failed: ${err.message}`);
      results.push({ ...business, success: false, error: err.message });
    }
  }

  // ── Final Report ────────────────────────────────────────────────────────────
  log('\n' + '═'.repeat(60));
  log('📊 PIPELINE RESULTS');
  log('═'.repeat(60));
  for (const r of results) {
    const icon = r.success ? '✅' : '❌';
    log(`${icon} ${r.name}`);
    if (r.previewUrl) log(`   Preview: ${r.previewUrl}`);
    if (r.githubRepo) log(`   GitHub:  ${r.githubRepo}`);
    if (r.pagesUrl)   log(`   Live:    ${r.pagesUrl}`);
    if (r.error)      log(`   Error:   ${r.error}`);
  }
  log('═'.repeat(60) + '\n');
}

// ─── Pipeline Steps ───────────────────────────────────────────────────────────

async function runPipeline(business, stepFilter) {
  const { slug, name, area, phone } = business;
  const assetDir = path.join(ASSETS_ROOT, slug);
  const result = {};

  // ── Step 1: Fetch assets ──────────────────────────────────────────────────
  if ((stepFilter === 'all' || stepFilter === 'fetch') && !noFetch) {
    const detailsPath = path.join(assetDir, 'details.json');
    if (fs.existsSync(detailsPath)) {
      log('📁 Assets already exist, skipping fetch');
    } else {
      log('\n🔍 Step 1: Fetching place assets from Google...');
      try {
        runScript('node', [
          path.join(__dirname, 'fetch-place-assets.js'),
          '--name', name,
          '--area', area || '',
          '--slug', slug,
          '--photos', '3',
        ]);
        log('✅ Assets fetched');
      } catch (err) {
        log(`⚠️  Asset fetch failed: ${err.message}`);
        log('   Continuing with existing/minimal assets...');
      }
    }
  }

  // ── Step 2: Generate prompt ───────────────────────────────────────────────
  if (stepFilter === 'all' || stepFilter === 'prompt') {
    const promptPath = path.join(assetDir, 'prompt.md');
    if (fs.existsSync(promptPath)) {
      log('\n📝 Step 2: prompt.md already exists, using it');
    } else {
      log('\n📝 Step 2: Generating prompt from template...');
      await generatePrompt(slug, assetDir, business);
      log('✅ Prompt generated');
    }
  }

  // ── Step 3: Build ─────────────────────────────────────────────────────────
  if (stepFilter === 'all' || stepFilter === 'build') {
    log('\n🏗️  Step 3: Running emergent-build.mjs...');
    const buildArgs = ['--slug', slug];
    if (noGithub) buildArgs.push('--no-github');

    try {
      runScript('node', [path.join(__dirname, 'emergent-build.mjs'), ...buildArgs], {
        stdio: 'inherit',
      });
    } catch (err) {
      // build script exits non-zero on failure
      throw new Error(`Build failed: ${err.message}`);
    }

    // Read build log for results
    const buildLogPath = path.join(assetDir, 'build-log.json');
    if (fs.existsSync(buildLogPath)) {
      const buildLog = JSON.parse(fs.readFileSync(buildLogPath, 'utf8'));
      result.jobId = buildLog.jobId;
      result.previewUrl = buildLog.previewUrl;
      result.githubRepo = buildLog.githubRepo;
      result.qualityPassed = buildLog.qualityPassed;
    }
  }

  // ── Step 4: Deploy to GitHub Pages ────────────────────────────────────────
  if (!noDeploy && (stepFilter === 'all' || stepFilter === 'deploy')) {
    const ghRepo = result.githubRepo || repoUrl;
    if (!ghRepo) {
      log('\n⏭️  Step 4: No GitHub repo URL, skipping GitHub Pages deploy');
    } else {
      log(`\n🚢 Step 4: Deploying to GitHub Pages...`);
      try {
        runScript('bash', [
          path.join(__dirname, 'deploy-gh-pages.sh'),
          ghRepo,
          '--slug', slug,
        ], { stdio: 'inherit' });

        // Derive pages URL
        const repoPath = ghRepo.replace('https://github.com/', '');
        const [owner, repoName] = repoPath.split('/');
        result.pagesUrl = `https://${owner}.github.io/${repoName}/`;
        log(`✅ GitHub Pages URL: ${result.pagesUrl}`);
      } catch (err) {
        log(`⚠️  Deploy failed: ${err.message}`);
      }
    }
  }

  return result;
}

// ─── Prompt Generator ─────────────────────────────────────────────────────────

async function generatePrompt(slug, assetDir, business) {
  const detailsPath = path.join(assetDir, 'details.json');
  const templatePath = path.join(__dirname, 'prompt-template.md');
  const outputPath = path.join(assetDir, 'prompt.md');

  fs.mkdirSync(assetDir, { recursive: true });

  let details = {};
  if (fs.existsSync(detailsPath)) {
    details = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
  }

  const name = details.name || business.name || slug;
  const address = details.formattedAddress || details.shortAddress || '';
  const phone = details.internationalPhoneNumber || details.nationalPhoneNumber || business.phone || '';
  const rating = details.rating || business.rating || '';
  const reviewCount = details.reviewCount || business.reviewCount || '';
  const mapsUrl = details.googleMapsUri || '';
  const category = formatCategory(details.types || [], details.primaryTypeDisplayName?.text);
  const hours = formatHours(details.regularOpeningHours);
  // Use only positive reviews (rating >= 4, or if no rating, include by default)
  const reviews = (details.reviews || [])
    .filter(r => !r.rating || r.rating >= 4)
    .slice(0, 5);
  const summary = details.editorialSummary?.text || '';

  // Count photos
  const photosDir = path.join(assetDir, 'photos');
  const photos = fs.existsSync(photosDir)
    ? fs.readdirSync(photosDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort()
    : [];

  // Build the prompt
  const prompt = `# ${name} — Website Prompt

## BUSINESS_FACTS
- Name: **${name}**
- Category: ${category}
- Address: ${address}
- Hours: ${hours}
- Phone: ${phone}
- Rating: ${rating} ⭐ (${reviewCount} Google reviews)
- Google Maps: ${mapsUrl}

## TONE_AND_STORY
${generateToneStory(details, business)}

## SIGNATURE_HIGHLIGHTS
${generateHighlights(details, reviews)}

## CUSTOMER_QUOTES
${reviews.slice(0, 5).map((r, i) => `${i + 1}. "${r.text?.slice(0, 200) || ''}" — ${r.name || 'Customer'}`).join('\n')}

## PRIORITY_ASSETS
${photos.map((p, i) => `${i + 1}. \`photos/${p}\` — business photo ${i + 1} (use in gallery and hero sections)`).join('\n')}

## CTA
Primary: "Call us now" (tel:${phone.replace(/\s+/g, '')})
Secondary: "Get directions" (${mapsUrl})

## PAGE_SECTIONS
1. **Hero** — Bold headline featuring the business name and key value proposition. CTA buttons for call and directions.
2. **About** — Brief description of the business, location, and what makes it special.
3. **Services / Highlights** — Key offerings, featured products, or specialties.
4. **Gallery** — Photos displayed in an attractive grid layout.
5. **Testimonials** — Customer review cards with star ratings.
6. **Contact & Hours** — Full address, opening hours, phone, Google Maps link.

## DESIGN_DIRECTION
- Professional, modern design suited for a ${category} business
- Mobile-first, fully responsive
- Colors: derive from business photos; use a clean, trustworthy palette
- Typography: clean, readable sans-serif fonts
- Overall feel: professional, welcoming, locally authentic

## TECHNICAL_REQUIREMENTS
- Framework: React with Vite (preferred) or Next.js static export
- Responsive at 375px, 768px, 1440px, 1920px
- Optimize images and lazy-load where possible
- Include package.json with a \`build\` script
- Deployable to GitHub Pages (static output)

Please build a complete, production-ready website based on all the above.`;

  fs.writeFileSync(outputPath, prompt);
  log(`✅ Prompt saved: ${outputPath}`);
}

function formatCategory(types, displayName) {
  if (displayName) return displayName;
  if (types.length === 0) return 'Local Business';
  return types.slice(0, 3)
    .map(t => t.replace(/_/g, ' '))
    .join(', ');
}

function formatHours(openingHours) {
  if (!openingHours?.weekdayDescriptions) return 'See Google Maps for hours';
  return openingHours.weekdayDescriptions.join('; ');
}

function generateToneStory(details, business) {
  const name = details.name || business.name;
  const category = details.primaryType || 'business';
  const area = business.area || details.shortAddress?.split(',')[0] || 'Bengaluru';
  const summary = details.editorialSummary?.text;

  if (summary) return summary;

  return `Create a warm, inviting atmosphere that captures the essence of ${name} in ${area}. ` +
    `Visitors should immediately understand why this is a top-rated ${category.replace(/_/g, ' ')} ` +
    `with ${details.reviewCount || 'hundreds of'} satisfied customers. ` +
    `Emphasize quality, warmth, and the authentic local experience.`;
}

function generateHighlights(details, reviews) {
  const highlights = [];

  if (details.rating && details.reviewCount) {
    highlights.push(`Rated ${details.rating}⭐ by ${details.reviewCount}+ customers on Google`);
  }

  if (details.primaryTypeDisplayName?.text) {
    highlights.push(`Premium ${details.primaryTypeDisplayName.text}`);
  }

  // Extract from reviews
  const reviewTexts = reviews.map(r => r.text || '').join(' ');
  if (reviewTexts.includes('friendly') || reviewTexts.includes('staff')) {
    highlights.push('Friendly, attentive service');
  }
  if (reviewTexts.includes('ambi') || reviewTexts.includes('cozy') || reviewTexts.includes('vibe')) {
    highlights.push('Great ambiance and atmosphere');
  }
  if (reviewTexts.includes('clean') || reviewTexts.includes('hygien')) {
    highlights.push('Clean and hygienic environment');
  }
  if (reviewTexts.includes('value') || reviewTexts.includes('price') || reviewTexts.includes('affordable')) {
    highlights.push('Excellent value for money');
  }

  // Defaults if not enough
  while (highlights.length < 3) {
    highlights.push('Locally loved and highly recommended');
    highlights.push('Convenient location in Bengaluru');
    highlights.push('Serving the community with pride');
  }

  return highlights.slice(0, 5).map(h => `- ${h}`).join('\n');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function runScript(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: PROJECT_ROOT,
    env: process.env,
    ...opts,
    stdio: opts.stdio || 'pipe',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const err = result.stderr || result.stdout || '';
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${result.status}): ${err.slice(0, 500)}`);
  }
  return result.stdout;
}

function parseLeadsFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const leads = [];

  // Match lines like: - 9. Envoq Salon - Jayanagar — Jayanagar | rating 4.9 (1200 reviews) | phone: +91 99558 85574
  const lineRe = /^-\s+\d+\.\s+(.+?)\s+—\s+(.+?)\s+\|\s+rating\s+([\d.]+)\s+\((\d+)\s+reviews?\)\s+\|\s+phone:\s+(\S+)/gm;
  let m;
  while ((m = lineRe.exec(content)) !== null) {
    const [, name, area, rating, reviewCount, phone] = m;
    // Skip duplicates (the shortlist has two identical sections)
    const slug = slugify(name);
    if (!leads.find(l => l.slug === slug)) {
      leads.push({ name: name.trim(), area: area.trim(), slug, rating, reviewCount, phone });
    }
  }
  return leads;
}

function hasExistingBuild(slug) {
  const buildLog = path.join(ASSETS_ROOT, slug, 'build-log.json');
  return fs.existsSync(buildLog);
}

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function log(msg) {
  console.log(msg);
}

// ─── Run ──────────────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error('\n💥 Fatal error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
