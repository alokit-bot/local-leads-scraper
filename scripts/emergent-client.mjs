/**
 * emergent-client.mjs — Emergent.sh API Client Module
 *
 * Wraps all Emergent.sh API endpoints with auth, token caching,
 * auto-refresh, and retry logic.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_CACHE_PATH = path.join(__dirname, '..', '.emergent-token-cache.json');

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://snksxwkyumhdykyrhhch.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNua3N4d2t5dW1oZHlreXJoaGNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjQ3NzI2NDYsImV4cCI6MjA0MDM0ODY0Nn0.3unO6zdz2NilPL2xdxt7OjvZA19copj3Q7ulIjPVDLQ';
const EMERGENT_API = 'https://api.emergent.sh';
const DEFAULT_EMAIL = 'alokitinnovations@gmail.com';
const DEFAULT_PASSWORD = '${EMERGENT_PASSWORD}';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// ─── Token Cache ───────────────────────────────────────────────────────────────

let _tokenCache = null;

function loadTokenCache() {
  if (_tokenCache) return _tokenCache;
  try {
    if (fs.existsSync(TOKEN_CACHE_PATH)) {
      _tokenCache = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf8'));
      return _tokenCache;
    }
  } catch (_) {}
  return null;
}

function saveTokenCache(cache) {
  _tokenCache = cache;
  try {
    fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn('Warning: could not save token cache:', err.message);
  }
}

function isTokenExpired(cache, bufferMs = 60_000) {
  if (!cache?.expires_at) return true;
  return Date.now() + bufferMs >= cache.expires_at;
}

// ─── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Login with email/password → returns access_token.
 * Result is cached on disk and reused until 1 min before expiry.
 */
export async function login(email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const cache = loadTokenCache();
  if (cache?.access_token && !isTokenExpired(cache)) {
    return cache.access_token;
  }

  // Try refresh first if we have a refresh token
  if (cache?.refresh_token && !isTokenExpired(cache, 0)) {
    try {
      const token = await refreshToken(cache.refresh_token);
      if (token) return token;
    } catch (_) {}
  }

  console.log('[emergent] Logging in to Supabase...');
  const resp = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Login failed (${resp.status}): ${err}`);
  }

  const data = await resp.json();
  saveTokenCache({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  console.log('[emergent] Logged in successfully.');
  return data.access_token;
}

async function refreshToken(refreshTok) {
  const resp = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshTok }),
    }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.access_token) return null;
  saveTokenCache({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

async function apiRequest(method, endpoint, body = null, extraHeaders = {}, retries = 3) {
  const token = await login();
  const url = endpoint.startsWith('http') ? endpoint : `${EMERGENT_API}${endpoint}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    ...extraHeaders,
  };

  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      const delay = 2000 * attempt;
      console.log(`[emergent] Retry ${attempt}/${retries - 1} in ${delay}ms...`);
      await sleep(delay);
    }

    try {
      const init = { method, headers };
      if (body !== null) {
        if (body instanceof FormData) {
          init.body = body;
          // Don't set Content-Type — fetch sets it with boundary
        } else {
          init.body = JSON.stringify(body);
          headers['Content-Type'] = 'application/json';
        }
      }

      const resp = await fetch(url, init);

      if (resp.status === 401 && attempt < retries - 1) {
        // Token expired mid-session — force re-login
        console.log('[emergent] 401 received — forcing re-login...');
        _tokenCache = null;
        try { fs.unlinkSync(TOKEN_CACHE_PATH); } catch (_) {}
        continue;
      }

      if (!resp.ok) {
        let errText = `HTTP ${resp.status} ${resp.statusText}`;
        try {
          const errJson = await resp.json();
          errText += `: ${JSON.stringify(errJson)}`;
        } catch (_) {
          errText += `: ${await resp.text().catch(() => '')}`;
        }
        const err = new Error(`Emergent API error [${method} ${endpoint}]: ${errText}`);
        err.statusCode = resp.status;
        // Don't retry on 4xx (client errors) — only 5xx or network errors
        if (resp.status >= 400 && resp.status < 500) throw err;
        throw err;
      }

      // Handle empty responses
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('application/json')) return resp.json();
      const buf = await resp.arrayBuffer();
      return buf;
    } catch (err) {
      lastErr = err;
      // Don't retry on 4xx client errors
      if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) throw err;
      if (attempt === retries - 1) throw err;
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Jobs API ─────────────────────────────────────────────────────────────────

/**
 * List all jobs.
 * @returns {Promise<{total_jobs: number, jobs: Array}>}
 */
export async function listJobs(limit = 250, offset = 0) {
  return apiRequest('GET', `/jobs/v0/?limit=${limit}&offset=${offset}`);
}

/**
 * Create a new website-build task in the queue.
 * @param {string} taskPrompt - The full prompt for the website
 * @param {string} clientRefId - UUID for idempotency
 * @param {object} opts - Optional overrides
 * @returns {Promise<object>} - Job object with id
 */
export async function createTask(taskPrompt, clientRefId, opts = {}) {
  const body = {
    client_ref_id: clientRefId,
    payload: {
      task: taskPrompt,
      processor_type: opts.processorType ?? 'env_only',
      is_cloud: opts.isCloud ?? true,
      env_image: opts.envImage ?? '',
      branch: opts.branch ?? '',
      repository: opts.repository ?? '',
    },
    model_name: opts.modelName ?? DEFAULT_MODEL,
  };
  return apiRequest('POST', '/jobs/v0/submit-queue/', body);
}

/**
 * Get details for a specific job.
 * @param {string} jobId
 * @returns {Promise<object>}
 */
export async function getJob(jobId) {
  return apiRequest('GET', `/jobs/v0/${jobId}/`);
}

/**
 * Get the preview URL for a completed job.
 * @param {string} jobId
 * @returns {Promise<{preview_url, base_preview_url, vscode_url, password, preview_screenshot_url}>}
 */
export async function getPreview(jobId) {
  return apiRequest('GET', `/jobs/v0/${jobId}/preview`);
}

/**
 * Get chat history for a job (may require admin).
 * @param {string} jobId
 */
export async function getChatHistory(jobId) {
  return apiRequest('GET', `/chat-history/v0/${jobId}`);
}

/**
 * Get the action log for a job (shows agent thoughts, questions, etc.).
 * @param {string} jobId
 * @returns {Promise<Array>}
 */
export async function getActions(jobId) {
  return apiRequest('GET', `/actions/${jobId}`);
}

/**
 * Respond to an agent HITL (human-in-the-loop) question.
 * For resume, both client_ref_id and id must match the original job's client_ref_id,
 * and env_image + model_name must match the original job.
 * @param {string} jobId - The job the agent is working on
 * @param {string} responseText - Your answer to the agent
 * @param {object} opts
 */
export async function respondToAgent(jobId, responseText, opts = {}) {
  // Get the original job to extract env_image, model_name, client_ref_id
  const job = await getJob(jobId);
  const clientRefId = job.client_ref_id || jobId;
  const envImage = job.payload?.env_image || opts.envImage || '';
  const modelName = job.payload?.model_name || opts.modelName || DEFAULT_MODEL;

  const body = {
    client_ref_id: clientRefId,
    payload: {
      task: responseText,
      processor_type: opts.processorType ?? 'env_only',
      is_cloud: opts.isCloud ?? true,
      env_image: envImage,
      branch: opts.branch ?? '',
      repository: opts.repository ?? '',
    },
    model_name: modelName,
    resume: true,
    id: clientRefId,
  };
  return apiRequest('POST', '/jobs/v0/hitl-queue/', body);
}

/**
 * Upload a file artifact to a job.
 * @param {string} jobId
 * @param {string} filePath - Local file path
 * @param {string} remoteName - Name to use in the job environment
 * @returns {Promise<object>}
 */
export async function uploadArtifact(jobId, filePath, remoteName) {
  const fileBuffer = fs.readFileSync(filePath);
  const filename = remoteName || path.basename(filePath);
  const mimeType = guessMimeType(filename);

  const form = new FormData();
  form.append(
    'file',
    new Blob([fileBuffer], { type: mimeType }),
    filename
  );

  const result = await apiRequest(
    'POST',
    `/artifacts/job/${jobId}/upload`,
    form
  );

  // Finalize the upload
  if (result?.artifact_id || result?.id) {
    const artifactId = result.artifact_id || result.id;
    await apiRequest('POST', '/artifacts/finalize-upload', {
      artifact_id: artifactId,
      job_id: jobId,
    });
  }

  return result;
}

/**
 * Download the job's code as a ZIP buffer.
 * @param {string} jobId
 * @param {string} outputPath - Local path to save the zip
 */
export async function downloadCode(jobId, outputPath) {
  const buffer = await apiRequest(
    'GET',
    `/download/pod-backup/download-zip?job_id=${jobId}`
  );
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  return outputPath;
}

/**
 * Stop a running job.
 * @param {string} jobId
 */
export async function stopJob(jobId) {
  return apiRequest('POST', '/jobs/stop', { id: jobId });
}

/**
 * Resume a paused job.
 * @param {string} jobId
 */
export async function resumeJob(jobId) {
  return apiRequest('POST', '/jobs/resume', { id: jobId });
}

/**
 * Deploy the job's output.
 * @param {string} jobId
 */
export async function deployJob(jobId) {
  return apiRequest('POST', '/jobs/v0/deploy', { id: jobId });
}

/**
 * Save the job's environment to GitHub (persist-environment).
 * @param {string} jobId
 * @param {object} opts - { repo_name, github_installation_id, ... }
 */
export async function persistEnvironment(jobId, opts = {}) {
  return apiRequest('POST', `/jobs/v0/${jobId}/persist-environment`, opts);
}

/**
 * List GitHub installations for the account.
 */
export async function listGitHubInstallations() {
  return apiRequest('GET', '/github/installations');
}

/**
 * Create a GitHub repository via Emergent.
 * @param {object} opts - { name, description, private, installation_id }
 */
export async function createGitHubRepo(opts = {}) {
  return apiRequest('POST', '/github/repositories', opts);
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function guessMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.zip': 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Poll a job until it reaches a terminal or target status.
 * @param {string} jobId
 * @param {object} opts
 * @param {number} opts.intervalMs - Poll interval (default 12000)
 * @param {number} opts.timeoutMs - Max wait (default 20 min)
 * @param {string[]} opts.terminalStatuses - Stop when job reaches one of these
 * @param {Function} opts.onStatus - Callback(job) on each poll
 * @returns {Promise<object>} Final job object
 */
export async function pollJob(jobId, opts = {}) {
  const {
    intervalMs = 12_000,
    timeoutMs = 20 * 60 * 1000,
    terminalStatuses = ['completed', 'failed', 'stopped', 'error'],
    onStatus = null,
  } = opts;

  const start = Date.now();
  while (true) {
    const job = await getJob(jobId);
    const status = job?.status ?? 'unknown';

    if (onStatus) onStatus(job);

    if (terminalStatuses.includes(status)) return job;

    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for job ${jobId} (last status: ${status})`
      );
    }

    await sleep(intervalMs);
  }
}
