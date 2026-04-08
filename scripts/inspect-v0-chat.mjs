#!/usr/bin/env node
import { v0 } from 'v0-sdk';

const chatId = process.argv[2];
if (!chatId) {
  console.error('Usage: node inspect-v0-chat.mjs <chatId>');
  process.exit(1);
}
if (!process.env.V0_API_KEY) {
  console.error('V0_API_KEY not set');
  process.exit(1);
}

const chat = await v0.chats.getById({ chatId });
console.log('chat:', { id: chat.id, projectId: chat.projectId, status: chat.latestVersion?.status, versionId: chat.latestVersion?.id });
if (chat.latestVersion?.id) {
  const version = await v0.chats.getVersion({ chatId, versionId: chat.latestVersion.id, includeDefaultFiles: true });
  console.log('version files:', version.files?.map((f) => f.name));
}
