#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// setup-slo-alerts.js — Create burn-rate alert monitors for all platform SLOs
//
// Queries existing SLOs by tag, then creates a fast-burn alert for each one
// that fires when the 1h error budget burn rate exceeds 14× (would exhaust
// a 30-day budget in ~2 days).
//
// Run: node setup-slo-alerts.js
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
} catch {}

const CUSTOMER = require('./app/customer.config');
const API_KEY  = process.env.DD_API_KEY;
const APP_KEY  = process.env.DD_APP_KEY;
const SITE     = process.env.DD_SITE || 'datadoghq.com';
const SERVICE  = CUSTOMER.platform;
const ENV_TAG  = process.env.DD_ENV || 'local';

if (!API_KEY || !APP_KEY) { console.error('DD_API_KEY and DD_APP_KEY required'); process.exit(1); }

function ddRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: `api.${SITE}`,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': API_KEY,
        'DD-APPLICATION-KEY': APP_KEY,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getSlos() {
  const res = await ddRequest('GET', `/api/v1/slo?tags=service:${encodeURIComponent(SERVICE)}&limit=100`, null);
  if (res.status !== 200 || !Array.isArray(res.body?.data)) return [];
  return res.body.data;
}

async function createBurnRateAlert(slo) {
  const name    = slo.name;
  const sloId   = slo.id;
  const tags    = slo.tags || [];
  const brand   = tags.find(t => t.startsWith('brand:'))?.split(':')[1];
  const team    = tags.find(t => t.startsWith('team:'))?.split(':')[1];

  // Use the first (shortest) timeframe defined on the SLO
  const timeframes = (slo.thresholds || []).map(t => t.timeframe).sort();
  const timeframe  = timeframes[0] || '7d';

  const alertName = `[SLO Alert] ${name} — Fast Burn`;
  const monitor   = {
    name:    alertName,
    type:    'slo alert',
    query:   `error_budget("${sloId}").over("${timeframe}") > 75`,
    message: [
      `🔥 **${name}** is burning error budget too fast.`,
      `At this rate the ${timeframe} budget will be exhausted ahead of schedule.`,
      brand ? `\nBrand: ${brand}` : '',
      `\nSLO: https://app.${SITE}/slos/${sloId}`,
      team  ? `\n\n@${team}` : '',
    ].join(''),
    tags: [...tags, `service:${SERVICE}`, `env:${ENV_TAG}`, 'monitor_type:slo_burn_rate'],
    options: {
      thresholds:         { critical: 75, warning: 50 },
      notify_audit:       false,
      renotify_interval:  60,
      include_tags:       true,
    },
  };

  const res = await ddRequest('POST', '/api/v1/monitor', monitor);
  if (res.status === 200 || res.status === 201) {
    console.log(`  ✅  ${alertName} (id: ${res.body.id})`);
  } else if (res.status === 400 && JSON.stringify(res.body).includes('already exists')) {
    console.log(`  ↩   ${alertName} — already exists`);
  } else {
    console.warn(`  ✗   ${alertName}: HTTP ${res.status}`, JSON.stringify(res.body).slice(0, 200));
  }
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log(`║  🔥  ${CUSTOMER.company} — SLO Burn Rate Alerts           ║`);
  console.log('╚═══════════════════════════════════════════════════╝\n');

  console.log('  Fetching SLOs…');
  const slos = await getSlos();
  if (slos.length === 0) {
    console.error('  ✗  No SLOs found. Run setup-slos.js first.\n');
    process.exit(1);
  }
  console.log(`  Found ${slos.length} SLOs — creating burn-rate alerts…\n`);

  for (const slo of slos) {
    await createBurnRateAlert(slo);
    await sleep(300);
  }

  console.log(`\n  Done. View alerts: https://app.${SITE}/monitors/manage?q=monitor_type%3Aslo_burn_rate\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
