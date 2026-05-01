#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const https= require('https');
const path = require('path');

try {
  fs.readFileSync('.env','utf8').split('\n').forEach(line=>{
    const m=line.match(/^([^#=]+)=(.*)$/);
    if(m) process.env[m[1].trim()]=m[2].trim();
  });
} catch{}

const API_KEY = process.env.DD_API_KEY;
const APP_KEY = process.env.DD_APP_KEY;
const SITE    = process.env.DD_SITE || 'datadoghq.com';

if (!API_KEY||!APP_KEY){ console.error('DD_API_KEY and DD_APP_KEY required'); process.exit(1); }

function ddRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: `api.${SITE}`,
      path:     urlPath,
      method,
      headers: {
        'Content-Type':       'application/json',
        'DD-API-KEY':         API_KEY,
        'DD-APPLICATION-KEY': APP_KEY,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let raw='';
      res.on('data',c=>raw+=c);
      res.on('end',()=>{ try{ resolve({status:res.statusCode,body:JSON.parse(raw)}); }catch{ resolve({status:res.statusCode,body:raw}); } });
    });
    req.on('error',reject);
    if(data) req.write(data);
    req.end();
  });
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

const CUSTOMER = require('./app/customer.config');
const SERVICE  = CUSTOMER.platform;
const BRANDS   = CUSTOMER.brands.map(b => b.key);

// Synthetics created by setup-rum.js — read from dd-assets.json
const ASSETS_PATH = path.join(__dirname,'app','public','dd-assets.json');

async function main() {
  console.log('🔒 Setting up Datadog Private Location for local synthetics…\n');

  // ── Step 1: Create the private location ──────────────────
  console.log('Step 1/4: Creating private location in Datadog…');
  const plRes = await ddRequest('POST', '/api/v1/synthetics/private-locations', {
    name:        `${CUSTOMER.company} — Local Demo`,
    description: 'Private location running on the demo laptop to test http://localhost:3000',
    tags:        ['env:local',`service:${SERVICE}`,`team:${CUSTOMER.platformTeam}`],
  });

  if (plRes.status !== 200 && plRes.status !== 201) {
    console.error('  ✗ Failed to create private location:', JSON.stringify(plRes.body));
    process.exit(1);
  }

  const plId     = plRes.body.private_location?.id;
  const plConfig = plRes.body.result_encryption; // full config JSON for the runner
  console.log(`  ✓ Private location created: ${plId}`);

  // Write the worker config to a file so docker-compose can mount it
  const configPath = path.join(__dirname, 'private-location-config.json');
  fs.writeFileSync(configPath, JSON.stringify(plRes.body.result_encryption, null, 2));
  console.log(`  ✓ Worker config written → private-location-config.json`);

  // ── Step 2: Update docker-compose.yml ───────────────────
  console.log('\nStep 2/4: Adding private location runner to docker-compose.yml…');
  const composePath = path.join(__dirname, 'docker-compose.yml');
  let compose = fs.readFileSync(composePath, 'utf8');

  const plService = `
  # ── Datadog Private Location ─────────────────────────────────────────────────
  # Runs synthetic tests against http://app:3000 (internal Docker network)
  private-location:
    image: gcr.io/datadoghq/synthetics-private-location-worker
    container_name: dd-private-location
    restart: unless-stopped
    volumes:
      - ./private-location-config.json:/etc/datadog/synthetics-check-runner.json:ro
    depends_on:
      - app
    extra_hosts:
      - "host.docker.internal:host-gateway"
`;

  if (compose.includes('private-location:')) {
    console.log('  ↩  Private location service already in docker-compose.yml');
  } else {
    compose = compose.trimEnd() + '\n' + plService;
    fs.writeFileSync(composePath, compose);
    console.log('  ✓ docker-compose.yml updated');
  }

  // ── Step 3: Find existing synthetics and update to private location ─────────
  console.log('\nStep 3/4: Updating synthetics to use private location…');
  const assets = JSON.parse(fs.readFileSync(ASSETS_PATH,'utf8'));
  const synthRum = assets.synthRum || {};

  for (const [key, publicId] of Object.entries(synthRum)) {
    if (!publicId) continue;

    // GET the test first
    const getRes = await ddRequest('GET', `/api/v1/synthetics/tests/${publicId}`);
    if (getRes.status !== 200) {
      console.warn(`  ✗ GET ${publicId}: ${getRes.status}`);
      continue;
    }

    const test = getRes.body;

    // Strip read-only fields that the PUT endpoint rejects
    const { created_at, creator, modified_at, monitor_id, public_id, ...writable } = test;

    // Rewrite URLs: host.docker.internal:3000 → app:3000 (Docker internal network)
    // Private location worker can reach the app container by service name
    const testStr = JSON.stringify(writable)
      .replace(/http:\/\/host\.docker\.internal:3000/g, 'http://app:3000');
    const updatedTest = JSON.parse(testStr);

    // Replace locations with our private location
    updatedTest.locations = [plId];

    // PUT the updated test
    const putRes = await ddRequest('PUT', `/api/v1/synthetics/tests/${publicId}`, updatedTest);
    if (putRes.status === 200) {
      console.log(`  ✓ Updated ${publicId} (${key}) → private location, URL: http://app:3000`);
    } else {
      console.warn(`  ✗ ${publicId}: ${putRes.status}`, JSON.stringify(putRes.body).slice(0,200));
    }
    await sleep(200);
  }

  // ── Step 4: Save private location ID to assets ───────────────────────────
  console.log('\nStep 4/4: Saving private location ID to dd-assets.json…');
  assets.privateLocationId = plId;
  fs.writeFileSync(ASSETS_PATH, JSON.stringify(assets, null, 2));
  console.log('  ✓ dd-assets.json updated');

  console.log(`
✅ Private location setup complete!

   Location ID:  ${plId}
   Runner image: gcr.io/datadoghq/synthetics-private-location-worker

Next step — start the private location runner:

   docker-compose up -d private-location

The worker will connect to Datadog and begin running synthetics against
http://app:3000 (the internal Docker network address of your app container).

Synthetics results will appear at:
   https://app.datadoghq.com/synthetics/tests
`);
}

main().catch(e => { console.error(e); process.exit(1); });
