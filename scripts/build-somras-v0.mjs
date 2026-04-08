#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v0 } from 'v0-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceRoot = path.resolve(__dirname, '..');
const promptPath = path.resolve(workspaceRoot, 'output/assets/somras-bar-kitchen/prompt.md');

// v0 attachments must be URLs — upload photos to tmpfiles.org first
const photoDir = path.resolve(workspaceRoot, 'output/assets/somras-bar-kitchen/photos');

async function uploadPhoto(filePath) {
  const { createReadStream } = await import('node:fs');
  const FormData = (await import('node:buffer')).Blob ? null : null;
  const data = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  // POST multipart to tmpfiles.org
  const boundary = 'X-ALOKIT-BOUNDARY';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const resp = await fetch('https://tmpfiles.org/api/v1/upload', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length)
    },
    body
  });
  const json = await resp.json();
  // tmpfiles returns: { status:'success', data:{ url:'https://tmpfiles.org/XXXXX/photo-1.jpg' }}
  // The direct dl URL is https://tmpfiles.org/dl/XXXXX/photo-1.jpg
  const rawUrl = json?.data?.url;
  if (!rawUrl) throw new Error(`Failed to upload ${filename}: ${JSON.stringify(json)}`);
  const dlUrl = rawUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
  console.log(`Uploaded ${filename} → ${dlUrl}`);
  return { url: dlUrl };
}

async function ensureProject(client, name) {
  const projects = await client.projects.find();
  const existing = projects.data?.find((proj) => proj.name === name);
  if (existing) {
    console.log('Using existing project:', existing.id, existing.name);
    return existing;
  }
  const proj = await client.projects.create({
    name,
    description: 'Somras Bar & Kitchen website — v0 Platform API managed'
  });
  console.log('Created project:', proj.id);
  return proj;
}

async function waitForVersionCompletion(client, chatId, intervalMs = 6000, timeoutMs = 600000) {
  const start = Date.now();
  while (true) {
    const chat = await client.chats.getById({ chatId });
    const version = chat.latestVersion;
    console.log(`  status: ${version?.status ?? 'pending'}`);
    if (version?.status === 'completed') return { chat, version };
    if (version?.status === 'failed') throw new Error(`v0 build failed for chat ${chatId}`);
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for build.');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function main() {
  if (!process.env.V0_API_KEY) throw new Error('V0_API_KEY is not set');

  const prompt = fs.readFileSync(promptPath, 'utf8');

  console.log('Uploading photos...');
  const attachments = await Promise.all(
    ['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg'].map((f) =>
      uploadPhoto(path.resolve(photoDir, f))
    )
  );

  const client = v0;
  const project = await ensureProject(client, 'SOMRAS BAR & KITCHEN');

  console.log('Creating v0 chat...');
  const chat = await client.chats.create({
    message: prompt,
    attachments,
    projectId: project.id,
    chatPrivacy: 'private',
    responseMode: 'async',
    metadata: { source: 'openclaw-automation', brand: 'somras' }
  });
  console.log('Chat created:', chat.id, chat.webUrl);

  console.log('Waiting for build to complete...');
  await new Promise((r) => setTimeout(r, 8000)); // brief settle delay for async mode
  const { chat: completedChat, version } = await waitForVersionCompletion(client, chat.id);
  console.log('Build complete! Demo:', version.demoUrl);

  const artifactDir = path.resolve(workspaceRoot, 'v0-artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });

  const zipBuffer = Buffer.from(
    await client.chats.downloadVersion({
      chatId: completedChat.id,
      versionId: version.id,
      format: 'zip'
    })
  );
  const zipPath = path.resolve(artifactDir, `somras-v0-build-${Date.now()}.zip`);
  fs.writeFileSync(zipPath, zipBuffer);

  const summary = {
    projectDashboard: project.webUrl,
    chatUrl: completedChat.webUrl,
    previewUrl: version.demoUrl,
    zipPath
  };
  fs.writeFileSync(path.resolve(artifactDir, 'latest-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nSummary:', JSON.stringify(summary, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
