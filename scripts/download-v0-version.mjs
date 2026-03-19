#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { v0 } from 'v0-sdk';

const chatId = process.argv[2];
if (!chatId) {
  console.error('Usage: node download-v0-version.mjs <chatId>');
  process.exit(1);
}
if (!process.env.V0_API_KEY) {
  throw new Error('V0_API_KEY not set');
}
const chat = await v0.chats.getById({ chatId });
const versionId = chat.latestVersion?.id;
if (!versionId) throw new Error('No version on chat');
const buffer = Buffer.from(
  await v0.chats.downloadVersion({ chatId, versionId, format: 'zip', includeDefaultFiles: true })
);
const outDir = path.resolve('v0-artifacts');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.resolve(outDir, `${chatId}-${versionId}.zip`);
fs.writeFileSync(outPath, buffer);
console.log('wrote', outPath);
