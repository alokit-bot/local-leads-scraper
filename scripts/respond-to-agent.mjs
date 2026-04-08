#!/usr/bin/env node
import { login } from './emergent-client.mjs';
import { randomUUID } from 'node:crypto';

const JOB_ID = process.argv[2] || 'bb4f7920-f91a-49c5-9360-b94c89b0cf63';
const message = process.argv[3] || `Great questions! Here are my answers:

1. **Contact Form & Backend**: Frontend-only website with direct call/directions CTAs. No backend needed. Use tel: links for calling and Google Maps links for directions.

2. **Business Photos**: Use beautiful, high-quality placeholder images that match a premium salon aesthetic. Use unsplash or similar royalty-free beauty/salon images.

3. **Services to Highlight**: Create a specific services menu with these categories:
   - Hair (cuts, coloring, styling, treatments)
   - Nails (manicure, pedicure, nail art)
   - Skincare (facials, cleanup, glow treatments)
   - Beauty (bridal, party makeup, threading)
   Keep pricing general (e.g. "Starting from ₹XXX") since we don't have exact prices.

4. **Appointment System**: Simple "Call to Book" approach with a prominent CTA button linking to tel:+919955885574

Please proceed and build a beautiful, professional website!`;

async function main() {
  console.log('Logging in...');
  const token = await login();
  
  // First get the job to find original env_image and model_name
  console.log('Getting job details...');
  const jobResp = await fetch(`https://api.emergent.sh/jobs/v0/${JOB_ID}/`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const job = await jobResp.json();
  const envImage = job.payload?.env_image || '';
  const modelName = job.payload?.model_name || 'claude-sonnet-4-5';
  const clientRefId = job.client_ref_id || JOB_ID;
  
  console.log(`  env_image: ${envImage}`);
  console.log(`  model_name: ${modelName}`);
  console.log(`  client_ref_id: ${clientRefId}`);

  // For HITL resume: client_ref_id = id = original job's client_ref_id
  const body = {
    client_ref_id: clientRefId,
    payload: {
      task: message,
      processor_type: 'env_only',
      is_cloud: true,
      env_image: envImage,
      branch: '',
      repository: '',
    },
    model_name: modelName,
    resume: true,
    id: clientRefId,
  };

  console.log('Sending HITL response...');
  const resp = await fetch('https://api.emergent.sh/jobs/v0/hitl-queue/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const result = await resp.json();
  console.log(`Status: ${resp.status}`);
  console.log('Result:', JSON.stringify(result, null, 2));
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
