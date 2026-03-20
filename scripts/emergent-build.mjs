#!/usr/bin/env node
/**
 * emergent-build.mjs — Main Build Orchestrator for Emergent.sh
 *
 * Usage:
 *   node scripts/emergent-build.mjs --slug envoq-salon-jayanagar [--no-github] [--no-screenshots]
 *
 * What it does:
 *   1. Reads prompt.md + details.json + photos from output/assets/<slug>/
 *   2. Creates a task on Emergent.sh
 *   3. Polls for status, auto-responds to agent questions
 *   4. Screenshots the preview at 4 viewports
 *   5. Assesses quality
 *   6. Saves to GitHub via persist-environment
 *   7. Downloads the code zip
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from '../node_modules/playwright/index.mjs';

import {
  login,
  createTask,
  getJob,
  getPreview,
  respondToAgent,
  downloadCode,
  persistEnvironment,
  pollJob,
  getCreditsBalance,
  getCreditsSummary,
} from './emergent-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

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
  node scripts/emergent-build.mjs --slug <business-slug> [options]

Options:
  --slug <slug>       Business slug matching output/assets/<slug>/ (required)
  --no-github         Skip persisting to GitHub
  --no-screenshots    Skip browser screenshots
  --no-download       Skip code download
  --model <name>      Model to use (default: claude-sonnet-4-6)
  --job-id <id>       Resume an existing job (skip task creation)
`);
  process.exit(0);
}

const slug = getFlag('--slug');
if (!slug) {
  console.error('Error: --slug is required');
  process.exit(1);
}

const skipGithub = hasFlag('--no-github');
const skipScreenshots = hasFlag('--no-screenshots');
const skipDownload = hasFlag('--no-download');
const modelName = getFlag('--model', 'claude-sonnet-4-6');
const resumeJobId = getFlag('--job-id');

// ─── Paths ────────────────────────────────────────────────────────────────────

const ASSET_DIR = path.join(PROJECT_ROOT, 'output', 'assets', slug);
const SCREENSHOTS_DIR = path.join(ASSET_DIR, 'screenshots');
const PROMPT_PATH = path.join(ASSET_DIR, 'prompt.md');
const DETAILS_PATH = path.join(ASSET_DIR, 'details.json');
const PHOTOS_DIR = path.join(ASSET_DIR, 'photos');
const BUILD_LOG_PATH = path.join(ASSET_DIR, 'build-log.json');

// ─── Viewports ────────────────────────────────────────────────────────────────

const VIEWPORTS = [
  { name: 'phone',  width: 375,  height: 812  },
  { name: 'tablet', width: 768,  height: 1024 },
  { name: 'laptop', width: 1440, height: 900  },
  { name: 'tv',     width: 1920, height: 1080 },
];

// ─── HITL auto-response patterns ─────────────────────────────────────────────
// If the agent asks something matching one of these patterns, we auto-respond.

const AUTO_RESPONSES = [
  {
    pattern: /what (color|colour|theme|palette|style)/i,
    response: 'Use the colors from the photos provided. Create a professional, modern design.',
  },
  {
    pattern: /what (font|typography)/i,
    response: 'Use clean, modern fonts. Prefer system fonts for performance.',
  },
  {
    pattern: /do you (want|need|prefer)/i,
    response: 'Yes, please proceed with the best approach for a local business website.',
  },
  {
    pattern: /should (i|we|it)/i,
    response: 'Yes, please proceed with the best approach for a professional local business website.',
  },
  {
    pattern: /any (specific|particular|additional)/i,
    response: 'No additional requirements. Please make it professional and mobile-friendly.',
  },
  {
    pattern: /clarif|more (info|information|detail)/i,
    response: 'No additional information needed. Please proceed with what you have.',
  },
  {
    pattern: /\?/,  // Any question — catch-all
    response: 'Please proceed with your best judgment for a professional local business website.',
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log(`\n🏗️  Emergent Build Orchestrator — ${slug}\n`);

  // Validate assets
  if (!fs.existsSync(ASSET_DIR)) {
    console.error(`Asset directory not found: ${ASSET_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(PROMPT_PATH)) {
    console.error(`prompt.md not found: ${PROMPT_PATH}`);
    process.exit(1);
  }

  // Load assets
  const promptText = fs.readFileSync(PROMPT_PATH, 'utf8');
  const details = fs.existsSync(DETAILS_PATH)
    ? JSON.parse(fs.readFileSync(DETAILS_PATH, 'utf8'))
    : {};

  log(`📋 Business: ${details.name || slug}`);
  log(`📝 Prompt length: ${promptText.length} chars`);

  // Build log for tracking
  const buildLog = {
    slug,
    startedAt: new Date().toISOString(),
    jobId: null,
    status: null,
    previewUrl: null,
    screenshotPaths: [],
    qualityPassed: null,
    githubRepo: null,
    codePath: null,
  };

  // Ensure screenshots dir
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  // ── Step 1: Auth ────────────────────────────────────────────────────────────
  log('\n🔐 Step 1: Authenticating...');
  await login();

  // Report starting credit balance
  let startBalance = null;
  try {
    startBalance = await getCreditsBalance();
    const summary = `${startBalance.ecu_balance?.toFixed(2)} ECU (${startBalance.monthly_credits_balance?.toFixed(2)} monthly + ${startBalance.daily_credits?.toFixed(2)} daily)`;
    log(`   💰 Starting balance: ${summary}`);
  } catch (e) {
    log(`   ⚠️  Could not fetch starting balance: ${e.message}`);
  }
  log('✅ Authenticated');

  // ── Step 2: Get/Create Job ─────────────────────────────────────────────────
  let jobId = resumeJobId;

  if (!jobId) {
    log('\n🚀 Step 2: Creating task on Emergent.sh...');

    // Upload photos first if available (as a reference)
    const photos = fs.existsSync(PHOTOS_DIR)
      ? fs.readdirSync(PHOTOS_DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort()
      : [];

    log(`📷 Found ${photos.length} photos`);

    // Build the full prompt with embedded instructions
    const fullPrompt = buildFullPrompt(promptText, details, photos, slug);

    const clientRefId = randomUUID();
    log(`🆔 Client ref ID: ${clientRefId}`);

    let createResult;
    try {
      createResult = await createTask(fullPrompt, clientRefId, { modelName });
    } catch (err) {
      console.error('Failed to create task:', err.message);
      process.exit(1);
    }

    // The API returns client_ref_id which equals the job ID (they're the same UUID)
    jobId = createResult?.id || createResult?.job_id || createResult?.client_ref_id;
    if (!jobId) {
      console.error('No job ID returned from createTask:', JSON.stringify(createResult));
      process.exit(1);
    }

    log(`✅ Task created! Job ID: ${jobId}`);
    log(`   → https://app.emergent.sh (check your dashboard)`);

    buildLog.jobId = jobId;
    saveBuildLog(buildLog);
  } else {
    log(`\n⏭️  Step 2: Resuming existing job ${jobId}`);
    buildLog.jobId = jobId;
  }

  // ── Step 3: Poll for completion ────────────────────────────────────────────
  log('\n⏳ Step 3: Monitoring build progress...');
  log('   (polling every 12 seconds, timeout 25 min)\n');

  let lastActionCount = 0;
  let lastStatus = null;
  const answeredQuestions = new Set();

  const finalJob = await pollJob(jobId, {
    intervalMs: 12_000,
    timeoutMs: 25 * 60 * 1000,
    onStatus: async (job) => {
      const status = job?.status ?? 'unknown';
      if (status !== lastStatus) {
        log(`   📊 Status: ${status}`);
        lastStatus = status;
        buildLog.status = status;
      }

      // Check if agent is asking a question (HITL) by checking job payload
      // The agent's HITL state is detected by changes in updated_at + IN_PROGRESS status
      // that persists for too long without progress. Also check service-status.
      try {
        if (job?.payload?.is_suspended || job?.state === 'WAITING_FOR_INPUT') {
          log(`   ⏸️  Agent appears to be waiting for input`);
          if (!answeredQuestions.has('auto_response_sent')) {
            const autoResponse = 'Please proceed with your best professional judgment. Use placeholder images where needed. Keep it frontend-only with tel: links for calling and Google Maps for directions. Create a specific services menu based on the business type. Use a "Call to Book" CTA approach.';
            log(`   💬 Auto-responding to agent...`);
            try {
              await respondToAgent(jobId, autoResponse);
              answeredQuestions.add('auto_response_sent');
              log(`   ✅ Auto-response sent`);
            } catch (err) {
              log(`   ⚠️  Failed to auto-respond: ${err.message}`);
            }
          }
        }
      } catch (err) {
        // Non-critical — just log and continue
        if (!err.message?.includes('404')) {
          log(`   ⚠️  HITL check failed: ${err.message?.slice(0, 100)}`);
        }
      }
    },
  });

  buildLog.status = finalJob?.status;
  log(`\n📊 Final status: ${finalJob?.status}`);

  if (finalJob?.status !== 'completed') {
    log(`\n❌ Build did not complete successfully (status: ${finalJob?.status})`);
    saveBuildLog(buildLog);

    if (finalJob?.status === 'failed') {
      process.exit(1);
    }
    // For other statuses (stopped, etc.), continue to try getting preview
  }

  // ── Step 4: Get preview URL ────────────────────────────────────────────────
  log('\n🌐 Step 4: Getting preview URL...');
  let previewData;
  try {
    previewData = await getPreview(jobId);
    log(`✅ Preview URL: ${previewData.preview_url}`);
    buildLog.previewUrl = previewData.preview_url;
    buildLog.previewData = previewData;
    saveBuildLog(buildLog);
  } catch (err) {
    log(`⚠️  Could not get preview: ${err.message}`);
  }

  // ── Step 5: Screenshots ────────────────────────────────────────────────────
  if (!skipScreenshots && previewData?.preview_url) {
    log('\n📸 Step 5: Taking screenshots...');
    const screenshotPaths = await takeScreenshots(previewData.preview_url, previewData.password);
    buildLog.screenshotPaths = screenshotPaths;
    saveBuildLog(buildLog);
  } else if (skipScreenshots) {
    log('\n⏭️  Step 5: Skipping screenshots (--no-screenshots)');
  } else {
    log('\n⏭️  Step 5: No preview URL, skipping screenshots');
  }

  // ── Step 6: Quality assessment ─────────────────────────────────────────────
  log('\n🔍 Step 6: Assessing quality...');
  const qualityResult = assessQuality(buildLog);
  buildLog.qualityPassed = qualityResult.passed;
  buildLog.qualityChecks = qualityResult.checks;
  saveBuildLog(buildLog);

  log(`   Quality checks:`);
  for (const [check, passed] of Object.entries(qualityResult.checks)) {
    log(`   ${passed ? '✅' : '❌'} ${check}`);
  }
  log(`   Overall: ${qualityResult.passed ? '✅ PASS' : '❌ FAIL'}`);

  // ── Step 7: Save to GitHub ─────────────────────────────────────────────────
  if (!skipGithub && qualityResult.passed) {
    log('\n💾 Step 7: Persisting to GitHub...');
    try {
      const repoName = `website-${slug}`;
      const persistResult = await persistEnvironment(jobId, {
        repo_name: repoName,
        is_private: false,
        description: `${details.name || slug} — AI-generated website`,
      });
      log(`✅ Persisted to GitHub!`);
      log(`   Repo: ${persistResult?.repo_url || repoName}`);
      buildLog.githubRepo = persistResult?.repo_url || `https://github.com/alokit-bot/${repoName}`;
      saveBuildLog(buildLog);
    } catch (err) {
      log(`⚠️  GitHub persist failed: ${err.message}`);
      log('   (You can manually run: node scripts/emergent-build.mjs --job-id ' + jobId + ')');
    }
  } else if (skipGithub) {
    log('\n⏭️  Step 7: Skipping GitHub (--no-github)');
  } else {
    log('\n⏭️  Step 7: Skipping GitHub (quality did not pass)');
  }

  // ── Step 8: Download code ──────────────────────────────────────────────────
  if (!skipDownload) {
    log('\n📦 Step 8: Downloading code zip...');
    const zipPath = path.join(ASSET_DIR, `${slug}-code.zip`);
    try {
      await downloadCode(jobId, zipPath);
      log(`✅ Code downloaded: ${zipPath}`);
      buildLog.codePath = zipPath;
      saveBuildLog(buildLog);
    } catch (err) {
      log(`⚠️  Code download failed: ${err.message}`);
    }
  } else {
    log('\n⏭️  Step 8: Skipping code download (--no-download)');
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  buildLog.completedAt = new Date().toISOString();
  saveBuildLog(buildLog);

  log('\n' + '═'.repeat(60));
  // Report ending credit balance
  let endBalance = null;
  let creditsUsed = null;
  try {
    endBalance = await getCreditsBalance();
    const endSummary = `${endBalance.ecu_balance?.toFixed(2)} ECU (${endBalance.monthly_credits_balance?.toFixed(2)} monthly + ${endBalance.daily_credits?.toFixed(2)} daily)`;
    log(`\n   💰 Ending balance: ${endSummary}`);
    if (startBalance) {
      creditsUsed = (startBalance.ecu_balance - endBalance.ecu_balance).toFixed(2);
      log(`   💸 Credits used: ${creditsUsed} ECU`);
    }
  } catch (e) {
    log(`   ⚠️  Could not fetch ending balance: ${e.message}`);
  }

  buildLog.credits = {
    startBalance: startBalance?.ecu_balance ?? null,
    endBalance: endBalance?.ecu_balance ?? null,
    used: creditsUsed ? parseFloat(creditsUsed) : null,
    plan: startBalance?.subscription?.name ?? null,
  };

  log('\n📊 BUILD SUMMARY');
  log('═'.repeat(60));
  log(`Slug:        ${slug}`);
  log(`Job ID:      ${buildLog.jobId}`);
  log(`Status:      ${buildLog.status}`);
  log(`Preview:     ${buildLog.previewUrl || 'N/A'}`);
  log(`Screenshots: ${buildLog.screenshotPaths.length} taken`);
  log(`Quality:     ${buildLog.qualityPassed ? '✅ PASS' : '❌ FAIL'}`);
  log(`GitHub:      ${buildLog.githubRepo || 'N/A'}`);
  log(`Code zip:    ${buildLog.codePath || 'N/A'}`);
  log(`Credits:     ${creditsUsed ? creditsUsed + ' ECU used' : 'N/A'} (${endBalance?.ecu_balance?.toFixed(2) ?? '?'} remaining)`);
  log(`Log saved:   ${BUILD_LOG_PATH}`);
  log('═'.repeat(60) + '\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(msg);
}

function saveBuildLog(data) {
  fs.mkdirSync(ASSET_DIR, { recursive: true });
  fs.writeFileSync(BUILD_LOG_PATH, JSON.stringify(data, null, 2));
}

function buildFullPrompt(basePrompt, details, photos, slug) {
  const photoNote = photos.length > 0
    ? `\n\n## REFERENCE PHOTOS\nI have ${photos.length} photos of this business. Please use these in the hero, gallery, and feature sections.`
    : '\n\n## PHOTOS\nNo business photos provided. Use beautiful, high-quality placeholder images from unsplash that match the business type aesthetic.';

  return `${basePrompt}${photoNote}

---
## TECHNICAL REQUIREMENTS
- Framework: React with Vite (preferred) or Next.js static export
- Responsive: mobile-first, tested at 375px, 768px, 1440px, 1920px
- Performance: optimize images, lazy-load where needed
- No external CMS dependencies — fully self-contained
- Include a package.json with build scripts

## CRITICAL INSTRUCTIONS
- **DO NOT ask clarifying questions.** Proceed with your best professional judgment immediately.
- Keep it frontend-only — use tel: links for calls and Google Maps links for directions.
- Use a "Call to Book" CTA approach for appointment-based businesses.
- Create a specific services menu based on the business category.
- Build everything in one go — no partial builds.
- Use beautiful placeholder images where no photos are available.

Please build a complete, production-ready website based on all the above.`;
}

function isQuestion(text) {
  // Detect if the agent text contains a genuine question
  const questionIndicators = [
    /\?[\s"]*$/m,
    /would you (like|prefer|want)/i,
    /do you (have|need|want)/i,
    /should (i|we)/i,
    /can you (provide|share|give)/i,
    /please (clarify|confirm|specify)/i,
  ];
  return questionIndicators.some(r => r.test(text));
}

function findAutoResponse(questionText) {
  for (const { pattern, response } of AUTO_RESPONSES) {
    if (pattern.test(questionText)) return response;
  }
  // Fallback for any question
  return 'Please proceed with your best professional judgment.';
}

async function takeScreenshots(previewUrl, password) {
  log(`   Opening: ${previewUrl}`);
  const paths = [];
  let browser;

  try {
    browser = await chromium.launch({ headless: true });

    for (const vp of VIEWPORTS) {
      log(`   📸 ${vp.name} (${vp.width}x${vp.height})...`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      try {
        // Navigate with auth if password is set
        if (password) {
          await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 30_000 });
          // Handle basic auth or password prompt
          const pwdInput = await page.$('input[type="password"]');
          if (pwdInput) {
            await pwdInput.fill(password);
            await page.keyboard.press('Enter');
            await page.waitForLoadState('networkidle', { timeout: 15_000 });
          }
        } else {
          await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 30_000 });
        }

        // Wait for content to render
        await page.waitForTimeout(2000);

        const screenshotPath = path.join(SCREENSHOTS_DIR, `${vp.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: vp.name !== 'phone' });
        log(`   ✅ Saved: screenshots/${vp.name}.png`);
        paths.push(screenshotPath);
      } catch (err) {
        log(`   ⚠️  Screenshot failed for ${vp.name}: ${err.message}`);
      } finally {
        await context.close();
      }
    }
  } catch (err) {
    log(`   ⚠️  Browser launch failed: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }

  return paths;
}

function assessQuality(buildLog) {
  const checks = {};

  // Build completed
  checks['Build completed'] = buildLog.status === 'completed';

  // Preview URL exists
  checks['Preview URL available'] = !!buildLog.previewUrl;

  // Screenshots taken
  checks['Screenshots captured'] = buildLog.screenshotPaths.length >= 2;

  // All 4 viewports screenshotted
  checks['All viewports covered'] = buildLog.screenshotPaths.length >= 4;

  // Not an error state
  checks['No error state'] = !['failed', 'error'].includes(buildLog.status);

  const passed = Object.values(checks).filter(Boolean).length >= 3;
  return { passed, checks };
}

// ─── Run ──────────────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error('\n💥 Fatal error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
