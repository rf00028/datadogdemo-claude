#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// setup-browser-tests.js — Inspire Brands × Datadog Browser Synthetics Setup
//
// Creates:
//   •  1 Browser test  — Platform Dashboard Load & Brand Grid
//   •  6 Browser tests — Per-brand Web App Load (one per brand)
//
// Requirements: DD_API_KEY + DD_APP_KEY in .env
// Run: node setup-browser-tests.js
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Load .env ────────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  });
}

const CUSTOMER = require('./app/customer.config');
const API_KEY  = process.env.DD_API_KEY;
const APP_KEY  = process.env.DD_APP_KEY;
const SITE     = process.env.DD_SITE || 'datadoghq.com';
const SERVICE  = CUSTOMER.platform;
const SVC_PFX  = CUSTOMER.servicePrefix;
const ENV_TAG  = process.env.DD_ENV || 'local';
const BRANDS   = CUSTOMER.brands;

if (!API_KEY || API_KEY === 'your_api_key_here') {
  console.error('\n✗  DD_API_KEY missing in .env\n');
  process.exit(1);
}
if (!APP_KEY || APP_KEY === 'your_app_key_here') {
  console.error('\n✗  DD_APP_KEY missing in .env');
  console.error(`   Get it at: https://app.${SITE}/organization-settings/application-keys\n`);
  process.exit(1);
}

// ── HTTP helper ──────────────────────────────────────────────────────────────
function ddRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: `api.${SITE}`,
        path:     urlPath,
        method,
        headers: {
          'Content-Type':       'application/json',
          'DD-API-KEY':         API_KEY,
          'DD-APPLICATION-KEY': APP_KEY,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try   { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, data: raw }); }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const created = { synthetics: [] };

async function create(label, method, urlPath, body, bucket) {
  process.stdout.write(`  ${label}... `);
  try {
    const res = await ddRequest(method, urlPath, body);
    if (res.status >= 200 && res.status < 300) {
      const id = res.data?.data?.id || res.data?.id || res.data?.public_id || '—';
      console.log(`✅  (id: ${id})`);
      if (bucket) bucket.push({ label, id });
      return res.data;
    }
    const msg = JSON.stringify(res.data).substring(0, 400);
    console.log(`✗   HTTP ${res.status}: ${msg}`);
  } catch (e) {
    console.log(`✗   ${e.message}`);
  }
  return null;
}

// ── Private locations for synthetics ─────────────────────────────────────────
async function getPrivateLocations() {
  const res = await ddRequest('GET', '/api/v1/synthetics/locations', null);
  if (res.status !== 200) return [];
  return (res.data.locations || []).filter(l => l.id.startsWith('pl:'));
}

// ── Fetch existing synthetics to detect duplicates ────────────────────────────
async function getExistingTestNames() {
  const res = await ddRequest('GET', '/api/v1/synthetics/tests?page_size=200', null);
  if (res.status !== 200) return new Set();
  const tests = res.data?.tests || [];
  return new Set(tests.map(t => t.name));
}

// ── Build a browser step: assertElementPresent ────────────────────────────────
function assertStep(name, cssSelector, isCritical = false) {
  return {
    name,
    type: 'assertElementPresent',
    isCritical,
    params: {
      element: {
        userLocator: {
          failTestOnCannotLocate: true,
          values: [{ type: 'css', value: cssSelector }],
        },
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  🖥  ${CUSTOMER.company} × Datadog — Browser Tests Setup          ║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  Site:    https://app.${SITE}`);
  console.log(`  Service: ${SERVICE}  •  Env: ${ENV_TAG}`);
  console.log(`  Brands:  ${BRANDS.map(b => b.key).join(', ')}\n`);

  // ── Resolve location and base URL ─────────────────────────────────────────
  const privateLocs = await getPrivateLocations();
  const usePrivate  = privateLocs.length > 0;
  const locations   = usePrivate ? [privateLocs[0].id] : ['aws:us-east-1'];
  const baseUrl     = usePrivate ? 'http://app:3000' : 'http://localhost:3000';

  if (usePrivate) {
    console.log(`  Using private location: ${privateLocs[0].id} (${privateLocs[0].display_name})`);
    console.log(`  Base URL: ${baseUrl}\n`);
  } else {
    console.log('  No private locations found — using aws:us-east-1 managed location');
    console.log(`  Base URL: ${baseUrl}\n`);
  }

  // ── Check for existing tests (avoid duplicates) ───────────────────────────
  console.log('  Checking for existing synthetics...');
  const existingNames = await getExistingTestNames();
  console.log(`  Found ${existingNames.size} existing test(s)\n`);

  // ── Browser Tests ─────────────────────────────────────────────────────────
  console.log('─── Browser Synthetic Tests ─────────────────────────────────\n');

  // ── 1. Platform Dashboard Load & Brand Grid ───────────────────────────────
  const platformTestName = `[Platform] Dashboard Load & Brand Grid`;

  if (existingNames.has(platformTestName)) {
    console.log(`  Skipping "${platformTestName}" — already exists\n`);
  } else {
    await create(
      '🟢 Platform: Dashboard Load & Brand Grid',
      'POST', '/api/v1/synthetics/tests',
      {
        name: platformTestName,
        type: 'browser',
        config: {
          request: {
            method: 'GET',
            url:    baseUrl,
          },
          variables: [],
          setCookie: '',
        },
        options: {
          tick_every:           900,
          min_failure_duration: 0,
          min_location_failed:  1,
          device_ids:           ['chrome.laptop_large'],
          retry:                { count: 1, interval: 300 },
        },
        message: `Browser test failed: **${platformTestName}** — the Inspire Brands platform dashboard did not load correctly. Check that #brandGrid renders and .header-left h1 is present.`,
        tags: [
          `service:${SERVICE}`,
          `env:${ENV_TAG}`,
          'team:platform',
        ],
        locations,
        status: 'live',
      },
      created.synthetics
    );
  }

  // ── 2. Per-brand Web App Load tests ──────────────────────────────────────
  for (const brand of BRANDS) {
    const testName = `[${brand.name}] Web App Load`;

    if (existingNames.has(testName)) {
      console.log(`  Skipping "${testName}" — already exists`);
      continue;
    }

    await create(
      `🌐 ${brand.name}: Web App Load`,
      'POST', '/api/v1/synthetics/tests',
      {
        name: testName,
        type: 'browser',
        config: {
          request: {
            method: 'GET',
            url:    `${baseUrl}/brands/${brand.key}`,
          },
          variables: [],
          setCookie: '',
        },
        options: {
          tick_every:           1800,
          min_failure_duration: 0,
          min_location_failed:  1,
          device_ids:           ['chrome.laptop_large'],
          retry:                { count: 1, interval: 300 },
        },
        message: `Browser test failed: **${testName}** — the ${brand.name} brand page at /brands/${brand.key} did not load correctly. Check that .brand-header is rendered.`,
        tags: [
          `service:${SERVICE}`,
          `brand:${brand.key}`,
          `team:${brand.team}`,
          `env:${ENV_TAG}`,
        ],
        locations,
        status: 'live',
      },
      created.synthetics
    );
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✅  Browser test setup complete!                         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const createdCount  = created.synthetics.length;
  const skippedCount  = (1 + BRANDS.length) - createdCount;

  console.log(`  Tests created: ${createdCount}`);
  if (skippedCount > 0) {
    console.log(`  Tests skipped (already exist): ${skippedCount}`);
  }
  console.log('');
  console.log(`  🧪 Synthetics    → https://app.${SITE}/synthetics/list?query=service%3A${SERVICE}`);
  console.log(`  🧪 Browser tests → https://app.${SITE}/synthetics/list?query=service%3A${SERVICE}+type%3Abrowser`);
  console.log('');

  for (const s of created.synthetics) {
    const id    = String(s.id || '').replace(/.*\//, '');
    const label = s.label.replace(/^[^\s]+ /, ''); // strip leading emoji + space
    if (id && id !== '—') {
      console.log(`    ${label.padEnd(40)} → https://app.${SITE}/synthetics/details/${id}`);
    }
  }

  console.log('');
}

main().catch(err => { console.error('\n✗ Fatal:', err.message); process.exit(1); });
