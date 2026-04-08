#!/usr/bin/env node
/**
 * pipeline.mjs — Integrated Pipeline Orchestrator
 *
 * Runs steps 1–2 automatically, then prints instructions for steps 3–4.
 *
 * STEP 1  ENRICH  — web presence check → enrich-business.sh → generate-rich-prompt.mjs
 * STEP 2  BUILD   — submit to Emergent, poll until done, save preview URL
 * STEP 3  DEPLOY  — (manual / separate run) save to GitHub via browser, then deploy-gh-pages.sh
 * STEP 4  OUTREACH— (manual / separate run) send WhatsApp message via openclaw
 * STEP 5  REPORT  — summary printed at the end
 *
 * Single-business usage:
 *   node scripts/pipeline.mjs --name "Business Name" --area "Location" \
 *     --slug slug --phone "+91..." --rating 4.8 --reviews 5100
 *
 * Batch usage (reads lead_shortlist.md, skips already-contacted):
 *   node scripts/pipeline.mjs --batch --count 4
 *
 * Re-run a specific step only:
 *   node scripts/pipeline.mjs --slug somras-bar-kitchen --step enrich
 *   node scripts/pipeline.mjs --slug somras-bar-kitchen --step build
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { config as dotenvConfig } from 'dotenv';
import { createTask, pollJob, getPreview } from './emergent-client.mjs';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Load .env from project root
dotenvConfig({ path: path.join(PROJECT_ROOT, '.env') });

// ─── Paths ────────────────────────────────────────────────────────────────────

const LEADS_PATH = path.join(PROJECT_ROOT, 'lead_shortlist.md');
const ASSETS_ROOT = path.join(PROJECT_ROOT, 'output', 'assets');
const TRACKER_PATH = path.join(PROJECT_ROOT, 'outreach', 'tracker.json');

// ─── CLI Args ─────────────────────────────────────────────────────────────────

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

Single business (steps 1–2 automated):
  --name <name>     Business name (required for single mode)
  --area <area>     Area / neighbourhood
  --slug <slug>     URL-safe slug (auto-derived from name if omitted)
  --phone <phone>   Phone in E.164 format (+91...)
  --rating <n>      Google rating (e.g. 4.8)
  --reviews <n>     Google review count (e.g. 5100)

Batch mode:
  --batch           Pick next N uncontacted leads from lead_shortlist.md
  --count <n>       How many to process (default: 1)

Step control:
  --step <step>     Run only: enrich | build | all (default: all)

Flags:
  --force-enrich    Re-run enrichment even if prompt already exists
  --force-build     Re-build even if build-log.json already exists
`);
  process.exit(0);
}

const batchMode  = hasFlag('--batch');
const count      = parseInt(getFlag('--count', '1'), 10);
const stepFilter = getFlag('--step', 'all');
const forceEnrich= hasFlag('--force-enrich');
const forceBuild = hasFlag('--force-build');

// In single mode, these come from flags
const cliSlug    = getFlag('--slug');
const cliName    = getFlag('--name');
const cliArea    = getFlag('--area', '');
const cliPhone   = getFlag('--phone', '');
const cliRating  = getFlag('--rating', '');
const cliReviews = getFlag('--reviews', '');

if (!batchMode && !cliName && !cliSlug) {
  console.error('Error: provide --name (and optionally --slug), or use --batch mode');
  process.exit(1);
}

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }
function logSection(title) {
  log('');
  log('─'.repeat(60));
  log(title);
  log('─'.repeat(60));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('\n🚀 Alokit Pipeline Orchestrator\n');

  // Build the list of businesses to process
  const queue = [];

  if (batchMode) {
    const leads   = parseLeadsFile(LEADS_PATH);
    const tracker = loadTracker();
    const contacted = new Set(tracker.outreach.map(o => o.business_slug));

    const pending = leads.filter(l => !contacted.has(l.slug)).slice(0, count);

    if (pending.length === 0) {
      log('✅ No uncontacted leads found — all done or shortlist is empty.');
      return;
    }
    log(`📋 Batch mode: ${pending.length} lead(s) to process`);
    for (const l of pending) log(`   → ${l.name} (${l.slug})`);
    queue.push(...pending);

  } else {
    // Single-business mode
    const slug = cliSlug || slugify(cliName);
    queue.push({
      slug,
      name:    cliName || slug,
      area:    cliArea,
      phone:   cliPhone,
      rating:  cliRating,
      reviews: cliReviews,
    });
  }

  // Process each business
  const results = [];
  for (const biz of queue) {
    logSection(`⚙️  Processing: ${biz.name} (${biz.slug})`);
    try {
      const r = await runPipeline(biz);
      results.push({ ...biz, ...r, success: true });
    } catch (err) {
      log(`\n❌ Failed: ${err.message}`);
      if (process.env.DEBUG) log(err.stack);
      results.push({ ...biz, success: false, error: err.message });
      // In batch mode keep going; single mode will exit 1 below
    }
  }

  printReport(results);

  const anyFailed = results.some(r => !r.success);
  if (anyFailed && !batchMode) process.exit(1);
}

// ─── Per-business Pipeline ────────────────────────────────────────────────────

async function runPipeline(biz) {
  const assetDir = path.join(ASSETS_ROOT, biz.slug);
  fs.mkdirSync(assetDir, { recursive: true });

  const result = {};

  // ─── STEP 1: ENRICH ────────────────────────────────────────────────────────
  if (stepFilter === 'all' || stepFilter === 'enrich') {
    logSection('🔍 STEP 1: Enrich');
    await stepEnrich(biz, assetDir, result);
  }

  // ─── STEP 2: BUILD ─────────────────────────────────────────────────────────
  if (stepFilter === 'all' || stepFilter === 'build') {
    logSection('🏗️  STEP 2: Build');
    await stepBuild(biz, assetDir, result);
  }

  // ─── STEP 3+: Instructions for manual steps ────────────────────────────────
  printManualSteps(biz, assetDir, result);

  return result;
}

// ─── STEP 1: Enrich ───────────────────────────────────────────────────────────

async function stepEnrich(biz, assetDir, result) {
  const promptPath      = path.join(assetDir, 'prompt.md');
  const enrichmentPath  = path.join(assetDir, 'prompt-enrichment.md');
  const detailsPath     = path.join(assetDir, 'details.json');

  // 1a.0. Seed details.json with known data from args (rating, reviews, phone, etc.)
  if (!fs.existsSync(detailsPath)) {
    const seed = {
      name: biz.name,
      slug: biz.slug,
      area: biz.area || '',
      rating: biz.rating || null,
      reviewCount: biz.reviews || null,
      phone: biz.phone || null,
      category: biz.category || null,
    };
    fs.writeFileSync(detailsPath, JSON.stringify(seed, null, 2));
    log(`  Seeded details.json with known data (${biz.rating}★, ${biz.reviews} reviews)`);
  } else {
    // Update rating/reviews if we have them from args but details.json doesn't
    try {
      const existing = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
      let changed = false;
      if (biz.rating && !existing.rating) { existing.rating = biz.rating; changed = true; }
      if (biz.reviews && !existing.reviewCount) { existing.reviewCount = biz.reviews; changed = true; }
      if (biz.phone && !existing.phone) { existing.phone = biz.phone; changed = true; }
      if (changed) {
        fs.writeFileSync(detailsPath, JSON.stringify(existing, null, 2));
        log(`  Updated details.json with args data`);
      }
    } catch {}
  }

  // 1a. Web presence check (non-blocking warning only)
  log('\n[1a] Web presence check...');
  try {
    const checkOut = runScript('node', [
      path.join(__dirname, 'web-presence-check.mjs'),
      biz.name,
      biz.area || '',
    ]);
    const checkResult = JSON.parse(checkOut);
    result.webPresence = checkResult;
    if (checkResult.warning && checkResult.candidates.length > 0) {
      log('  ⚠️  Possible existing websites:');
      for (const c of checkResult.candidates) {
        log(`     ${c.domain} (score ${c.score}) — ${c.url}`);
      }
      log('  Continuing — review before sending outreach.');
    } else {
      log('  ✅ No existing website detected.');
    }
  } catch (err) {
    log(`  ℹ️  Web presence check skipped (${err.message.slice(0, 80)})`);
  }

  // 1a.5. Scrape Google Maps via browser CLI for real business data
  log('\n[1a.5] Scraping Google Maps via browser...');
  try {
    const gmapsOut = runScript('bash', [
      path.join(__dirname, 'scrape-gmaps-cli.sh'),
      biz.name,
      biz.area || '',
      biz.slug,
    ], { cwd: PROJECT_ROOT });
    log('  ' + gmapsOut.trim().split('\n').filter(l => l.includes('✅')).join('\n  '));
    log('  ✅ Google Maps scrape done');
  } catch (err) {
    log(`  ⚠️  Google Maps scrape failed (non-blocking): ${err.message.slice(0, 120)}`);
  }

  // 1b. Run enrich-business.sh (Zomato / JustDial scraping + merge with details.json)
  log('\n[1b] Running enrich-business.sh...');
  try {
    // If details.json already has reviews, enrich-business.sh will use them
    const enrichOut = runScript('bash', [
      path.join(__dirname, 'enrich-business.sh'),
      biz.name,
      biz.area || '',
      biz.slug,
    ], { cwd: PROJECT_ROOT });
    log('  ' + enrichOut.trim().split('\n').slice(-3).join('\n  '));
    log('  ✅ Enrichment done');
  } catch (err) {
    log(`  ⚠️  Enrichment failed (non-blocking): ${err.message.slice(0, 120)}`);
  }

  // 1c–1e. Generate enriched prompt (or append enrichment if prompt already exists)
  const shouldGenerate = !fs.existsSync(promptPath) || forceEnrich;
  if (shouldGenerate) {
    log('\n[1d] Generating enriched prompt...');
    try {
      const genOut = runScript('node', [
        path.join(__dirname, 'generate-rich-prompt.mjs'),
        '--slug', biz.slug,
      ], { cwd: PROJECT_ROOT });
      log('  ' + genOut.trim());
    } catch (err) {
      // Fallback: inline prompt generation using business facts
      log(`  ⚠️  generate-rich-prompt.mjs failed, using inline fallback: ${err.message.slice(0, 80)}`);
      generateFallbackPrompt(biz, assetDir, detailsPath, enrichmentPath, promptPath);
    }
  } else {
    log('\n[1d] prompt.md already exists');
    // 1e. Append enrichment if not already present
    if (fs.existsSync(enrichmentPath)) {
      const current = fs.readFileSync(promptPath, 'utf8');
      if (!current.includes('═══ ENRICHED DATA')) {
        const enrichment = fs.readFileSync(enrichmentPath, 'utf8');
        fs.writeFileSync(promptPath, current + '\n' + enrichment);
        log('  ✅ Appended enrichment to existing prompt');
      } else {
        log('  ✅ Prompt already has enrichment data');
      }
    }
  }

  // Confirm prompt exists
  if (fs.existsSync(promptPath)) {
    const promptLen = fs.readFileSync(promptPath, 'utf8').length;
    result.promptPath = promptPath;
    log(`\n  ✅ Prompt ready (${promptLen} chars): ${promptPath}`);
  } else {
    throw new Error('Prompt generation failed — no prompt.md found in ' + assetDir);
  }
}

// ─── STEP 2: Build ────────────────────────────────────────────────────────────

async function stepBuild(biz, assetDir, result) {
  const buildLogPath = path.join(assetDir, 'build-log.json');
  const promptPath   = path.join(assetDir, 'prompt.md');

  // Skip if already built (unless forced)
  if (fs.existsSync(buildLogPath) && !forceBuild) {
    const existing = JSON.parse(fs.readFileSync(buildLogPath, 'utf8'));
    log('  📋 Build already exists — skipping (use --force-build to re-run)');
    log(`  Preview: ${existing.previewUrl || '(none)'}`);
    result.jobId      = existing.jobId;
    result.previewUrl = existing.previewUrl;
    result.buildStatus= existing.status;
    return;
  }

  // Read prompt
  if (!fs.existsSync(promptPath)) {
    throw new Error('No prompt.md found — run enrich step first');
  }
  const prompt = fs.readFileSync(promptPath, 'utf8');

  // 2b. Submit to Emergent
  log('\n[2b] Submitting to Emergent API...');
  const clientRefId = randomUUID();
  const taskResp = await createTask(prompt, clientRefId);
  const jobId = taskResp?.id || taskResp?.job_id;
  if (!jobId) throw new Error('createTask returned no job ID: ' + JSON.stringify(taskResp));
  log(`  ✅ Job created: ${jobId}`);

  // 2c. Poll for completion (max 15 min)
  log('\n[2c] Polling for completion (max 15 min)...');
  let dots = 0;
  const finalJob = await pollJob(jobId, {
    intervalMs:       20_000,
    timeoutMs:        15 * 60 * 1000,
    terminalStatuses: ['completed', 'failed', 'stopped', 'error'],
    onStatus: (job) => {
      dots++;
      const statusLine = `  [${new Date().toISOString().slice(11,19)}] Status: ${job.status}`;
      process.stdout.write(statusLine + (dots % 3 === 0 ? '\n' : '\r'));
    },
  });
  log('');

  if (finalJob.status !== 'completed') {
    throw new Error(`Emergent build ended with status: ${finalJob.status}`);
  }
  log(`  ✅ Build completed (status: ${finalJob.status})`);

  // 2d. Get preview URL
  let previewUrl = null;
  try {
    const preview = await getPreview(jobId);
    previewUrl = preview?.preview_url || preview?.base_preview_url || null;
  } catch (e) {
    log(`  ⚠️  Could not fetch preview URL: ${e.message}`);
  }
  result.jobId      = jobId;
  result.previewUrl = previewUrl;
  result.buildStatus= finalJob.status;
  if (previewUrl) log(`  🌐 Preview: ${previewUrl}`);

  // Save build log
  const buildLog = {
    jobId,
    clientRefId,
    status:     finalJob.status,
    previewUrl,
    builtAt:    new Date().toISOString(),
    slug:       biz.slug,
    name:       biz.name,
  };
  fs.writeFileSync(buildLogPath, JSON.stringify(buildLog, null, 2));
  log(`  💾 Build log saved: ${buildLogPath}`);
}

// ─── Manual Steps Output ──────────────────────────────────────────────────────

function printManualSteps(biz, assetDir, result) {
  if (!result.previewUrl && !result.jobId) return;

  const detailsPath = path.join(assetDir, 'details.json');
  const repoName    = `website-${biz.slug}`;
  const repoUrl     = `https://github.com/alokit-bot/${repoName}`;
  const pagesUrl    = `https://alokit-bot.github.io/${repoName}/`;

  log('\n');
  log('═'.repeat(60));
  log('📋 NEXT STEPS (manual)');
  log('═'.repeat(60));

  log('\n🔧 STEP 3 — Deploy to GitHub Pages');
  log(`  1. Open Emergent preview: ${result.previewUrl || '(see build-log.json)'}`);
  log(`  2. In Emergent UI → click "Save to GitHub"`);
  log(`     → Repo name: ${repoName}`);
  log(`     → Account: alokit-bot`);
  log(`  3. Once repo is created, run:`);
  log(`     bash scripts/deploy-gh-pages.sh ${repoUrl} ${repoName} ${detailsPath}`);
  log(`  4. Live URL will be: ${pagesUrl}`);

  // Determine WhatsApp variant hint based on simple signals
  const variant = selectVariant(biz, result);
  const phone   = normalisePhone(biz.phone);
  const waMsg   = buildWhatsAppMessage(biz, pagesUrl, variant);

  log('\n📱 STEP 4 — WhatsApp Outreach');
  log(`  Phone:   ${phone || biz.phone || '(unknown)'}`);
  log(`  Variant: ${variant}`);
  log('  Message preview:');
  log('  ┌─────────────────────────────────────────────────');
  for (const line of waMsg.split('\n')) log(`  │ ${line}`);
  log('  └─────────────────────────────────────────────────');
  log('\n  When ready to send (after deploy), run:');
  log(`  openclaw message send --channel whatsapp --account business \\`);
  log(`    --target "${phone || biz.phone}" \\`);
  log(`    --message "${waMsg.replace(/"/g, '\\"')}"`);

  log('\n  Then log to tracker.json with:');
  log(`  node scripts/log-outreach.mjs --slug ${biz.slug} --variant ${variant} --status sent`);
  log('═'.repeat(60));
}

// ─── STEP 5: Report ───────────────────────────────────────────────────────────

function printReport(results) {
  log('\n');
  log('═'.repeat(60));
  log('📊 PIPELINE RESULTS');
  log('═'.repeat(60));
  for (const r of results) {
    const icon = r.success ? '✅' : '❌';
    log(`${icon} ${r.name} (${r.slug})`);
    if (r.previewUrl) log(`   Preview:  ${r.previewUrl}`);
    if (r.jobId)      log(`   Job ID:   ${r.jobId}`);
    if (r.error)      log(`   Error:    ${r.error}`);
  }
  log('═'.repeat(60) + '\n');
}

// ─── Helpers: Variant Selection ───────────────────────────────────────────────

/**
 * Choose a WhatsApp message variant based on observable business signals.
 * See outreach/PLAYBOOK.md for full rationale.
 *
 * A — Consultative (high digital awareness)
 * B — Impressed Customer (low-digital but high rating)
 * C — Growth Partner (growth-phase)
 * D — Visual-First (short, for busy owners)
 */
function selectVariant(biz, result) {
  const webPresence = result.webPresence;
  const candidateCount = webPresence?.candidates?.length ?? 0;

  // High digital awareness → Variant A
  if (candidateCount > 0) return 'A';

  const reviews = parseInt(biz.reviews, 10) || 0;
  const rating  = parseFloat(biz.rating) || 0;

  // Growing fast → Variant C
  if (reviews > 5000) return 'C';

  // High rating, low digital presence → Variant B
  if (rating >= 4.7) return 'B';

  // Default: short visual-first
  return 'D';
}

function buildWhatsAppMessage(biz, websiteUrl, variant) {
  const name    = biz.name;
  const rating  = biz.rating  || '4.8';
  const reviews = biz.reviews || '1000';

  switch (variant) {
    case 'A':
      return `Hi! I came across ${name} on Google Maps — ${rating}★ with ${reviews} reviews is impressive. 👏\n\nI work with local businesses on their digital presence — helping them get discovered by more customers and keep the ones they have coming back.\n\nI actually put together a sample website for ${name} to show one idea of what's possible: ${websiteUrl}\n\nWould love to hear what's working for you today and where you feel you're leaving customers on the table. No pitch — just curious.`;

    case 'B':
      return `Hi! I was checking out ${name} online and honestly impressed — ${rating}★ with ${reviews} reviews speaks for itself.\n\nOne thing I noticed though: when people search for you, there's no website to land on. You're missing out on everyone who wants to check you out before visiting.\n\nI took the liberty of putting one together: ${websiteUrl}\n\nThought you might find it useful. Happy to chat if you're interested!`;

    case 'C':
      return `Hi ${name} team! 👋\n\n${rating}★ on Google Maps with ${reviews} reviews — you're clearly doing something right.\n\nI help local businesses like yours turn that offline reputation into online growth — more discovery, more first-time visitors, better retention.\n\nStarted with a sample website to give you a feel: ${websiteUrl}\n\nWhat's your biggest challenge right now — getting new customers in, or keeping regulars coming back?`;

    case 'D':
    default:
      return `Hi! I built this for ${name}: ${websiteUrl}\n\n${rating}★, ${reviews} reviews — your place deserves a web presence that matches. This is just a sample — would love to make it truly yours.\n\n— Alokit, Nextahalli`;
  }
}

// ─── Helpers: Fallback Prompt Generator ───────────────────────────────────────

/**
 * Minimal inline prompt — only used if generate-rich-prompt.mjs fails.
 */
function generateFallbackPrompt(biz, assetDir, detailsPath, enrichmentPath, promptPath) {
  let details = {};
  if (fs.existsSync(detailsPath)) {
    try { details = JSON.parse(fs.readFileSync(detailsPath, 'utf8')); } catch {}
  }

  const name    = details.name    || biz.name    || biz.slug;
  const address = details.formattedAddress || biz.area || '';
  const phone   = details.internationalPhoneNumber || biz.phone || '';
  const rating  = details.rating  || biz.rating  || '';
  const reviews = details.reviewCount || biz.reviews || '';
  const category= details.primaryTypeDisplayName?.text || 'Business';
  const mapsUrl = details.googleMapsUri || '';

  let prompt = `# ${name} — Website Prompt

## BUSINESS_FACTS
- Name: **${name}**
- Category: ${category}
- Address: ${address}
- Phone: ${phone}
- Rating: ${rating}★ (${reviews}+ Google reviews)
- Google Maps: ${mapsUrl}

## SECTIONS
1. **Hero** — Name, rating badge, CTA (call + directions)
2. **About** — Story, what makes them special
3. **Services / Menu** — Key offerings with INR pricing
4. **Gallery** — Business photos
5. **Testimonials** — Customer reviews
6. **Contact & Hours** — Phone (tel: link), address, map link, hours

## DESIGN
- Modern, mobile-first, professional
- React + Vite, responsive at 375/768/1440/1920px
- No backend, no server — static only
- Include package.json with a \`build\` script
- Deployable to GitHub Pages

## IMPORTANT
- DO NOT ask clarifying questions. Build immediately with best judgment.
- Use tel: link for phone, Google Maps link for directions.
- Use ₹ for pricing.
`;

  // Append enrichment if available
  if (fs.existsSync(enrichmentPath)) {
    prompt += '\n' + fs.readFileSync(enrichmentPath, 'utf8');
  }

  fs.writeFileSync(promptPath, prompt);
  log(`  ✅ Fallback prompt written (${prompt.length} chars)`);
}

// ─── Helpers: Lead Parsing ────────────────────────────────────────────────────

/**
 * Parse lead_shortlist.md into a list of business objects.
 * Handles lines like:
 *   - 1. SOMRAS BAR & KITCHEN — HSR Layout | rating 4.8 (5100 reviews) | phone: +91 96638 46153 (score 0.9547)
 */
function parseLeadsFile(filePath) {
  if (!fs.existsSync(filePath)) {
    log(`⚠️  Lead file not found: ${filePath}`);
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const leads   = [];
  const seen    = new Set();

  const re = /^-\s+\d+\.\s+(.+?)\s+—\s+(.+?)\s+\|\s+rating\s+([\d.]+)\s+\((\d+)\s+reviews?\)\s+\|\s+phone:\s+(\S+)/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    const [, name, area, rating, reviews, phone] = m;
    const slug = slugify(name.trim());
    if (seen.has(slug)) continue; // shortlist has duplicate sections
    seen.add(slug);
    leads.push({
      name:    name.trim(),
      area:    area.trim(),
      slug,
      rating:  rating.trim(),
      reviews: reviews.trim(),
      phone:   normalisePhone(phone.trim()),
    });
  }
  return leads;
}

// ─── Helpers: Tracker ─────────────────────────────────────────────────────────

function loadTracker() {
  if (!fs.existsSync(TRACKER_PATH)) return { meta: {}, outreach: [] };
  try {
    return JSON.parse(fs.readFileSync(TRACKER_PATH, 'utf8'));
  } catch {
    return { meta: {}, outreach: [] };
  }
}

// ─── Helpers: Shell ───────────────────────────────────────────────────────────

function runScript(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd:      opts.cwd || PROJECT_ROOT,
    env:      process.env,
    stdio:    'pipe',
    encoding: 'utf8',
    timeout:  120_000,
    ...opts,
  });
  if (result.status !== 0) {
    const errMsg = (result.stderr || result.stdout || '').slice(0, 600);
    throw new Error(`${cmd} ${args.join(' ')} → exit ${result.status}: ${errMsg}`);
  }
  return result.stdout || '';
}

// ─── Helpers: String Utils ────────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Normalise a phone string to E.164.
 * "+91 96638 46153" → "+919663846153"
 */
function normalisePhone(phone) {
  if (!phone) return '';
  // Strip spaces and dashes; keep leading +
  const digits = phone.replace(/[\s\-().]/g, '');
  // If already starts with +, return as-is
  if (digits.startsWith('+')) return digits;
  // Indian numbers: if 10 digits, prepend +91
  if (/^\d{10}$/.test(digits)) return '+91' + digits;
  return digits;
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('\n💥 Fatal error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
