#!/usr/bin/env node
import { v0 } from 'v0-sdk';

if (!process.env.V0_API_KEY) {
  console.error('V0_API_KEY not set');
  process.exit(1);
}

const plan = await v0.user.getPlan();
console.log(JSON.stringify(plan, null, 2));
