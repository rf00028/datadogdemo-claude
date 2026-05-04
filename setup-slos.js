#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// setup-slos.js — Create Datadog SLOs across all platform services
//
// Requires setup-datadog.js to have been run first (monitors must exist).
//
// Creates:
//   • 2 per brand × 6 brands = 12 per-brand SLOs
//       - [Brand] POS Availability     (99.5% over 30d)
//       - [Brand] POS Latency SLO      (99%   over  7d)
//   • 3 platform-wide SLOs
//       - Platform Availability        (99.9% over 30d)
//       - Loyalty Service Health       (99.9% over 30d)
//       - Delivery SLA                 (95%   over  7d)
//   Total: 15 SLOs
//
// Also appends an SLO summary widget to the executive overview dashboard.
//
// Run: node setup-slos.js
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
const ENV_TAG  = process.env.DD_ENV || 'local';
const BRANDS   = CUSTOMER.brands;

if (!API_KEY || API_KEY === 'your_api_key_here') {
  console.error('\n✗  DD_API_KEY missing in .env\n'); process.exit(1);
}
if (!APP_KEY || APP_KEY === 'your_app_key_here') {
  console.error('\n✗  DD_APP_KEY missing in .env\n'); process.exit(1);
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

async function create(label, urlPath, body) {
  process.stdout.write(`  ${label}... `);
  try {
    const res = await ddRequest('POST', urlPath, body);
    if (res.status >= 200 && res.status < 300) {
      const id = res.data?.data?.id || res.data?.id || '—';
      console.log(`✅  (id: ${id})`);
      return res.data;
    }
    console.log(`✗  HTTP ${res.status}: ${JSON.stringify(res.data).substring(0, 300)}`);
  } catch (e) {
    console.log(`✗  ${e.message}`);
  }
  return null;
}

// ── Find monitors by tag ─────────────────────────────────────────────────────
// Returns a map of monitor name → monitor ID
async function findMonitorsByTag(tags) {
  const params = tags.map(t => `monitor_tags=${encodeURIComponent(t)}`).join('&');
  const res    = await ddRequest('GET', `/api/v1/monitor?${params}&page_size=100`, null);
  if (res.status !== 200 || !Array.isArray(res.data)) return {};
  return Object.fromEntries(res.data.map(m => [m.name, m.id]));
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  📊  ${CUSTOMER.company} × Datadog — SLO Setup                 ║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  Site:    https://app.${SITE}`);
  console.log(`  Service: ${SERVICE}\n`);

  const createdSlos = [];

  // ── Discover existing monitors ────────────────────────────────────────────
  console.log('─── Discovering monitors ────────────────────────────────────\n');

  const [errorMonitors, latencyMonitors, platformMonitors] = await Promise.all([
    findMonitorsByTag([`service:${SERVICE}`, 'monitor_type:errors']),
    findMonitorsByTag([`service:${SERVICE}`, 'monitor_type:latency']),
    findMonitorsByTag([`service:${SERVICE}`, `team:${CUSTOMER.platformTeam}`]),
  ]);

  const allFound = Object.keys(errorMonitors).length + Object.keys(latencyMonitors).length + Object.keys(platformMonitors).length;
  console.log(`  Found ${allFound} relevant monitors`);

  if (allFound === 0) {
    console.log('\n  ⚠  No monitors found. Run setup-datadog.js first, then re-run this script.\n');
    process.exit(1);
  }

  // ── Per-brand SLOs ────────────────────────────────────────────────────────
  console.log('\n─── Per-Brand SLOs ─────────────────────────────────────────\n');

  for (const brand of BRANDS) {
    // Find this brand's error-rate and latency monitors
    const errMonitorName = `[${brand.name}] POS Error Rate — > 5 errors in 5m`;
    const latMonitorName = `[${brand.name}] POS p95 Latency > 1500ms`;

    const errId = errorMonitors[errMonitorName];
    const latId = latencyMonitors[latMonitorName];

    if (errId) {
      const result = await create(
        `✅ ${brand.name}: POS Availability`,
        '/api/v1/slo',
        {
          name:        `[${brand.name}] POS Availability`,
          description: `Tracks the percentage of time the ${brand.name} POS error rate is below threshold. Fires when ${brand.name} POS errors exceed 5 in a 5-minute window.`,
          type:        'monitor',
          monitor_ids: [errId],
          thresholds:  [
            { timeframe: '7d',  target: 99.0, warning: 99.5 },
            { timeframe: '30d', target: 99.5, warning: 99.9 },
          ],
          tags: [`service:${SERVICE}`, `brand:${brand.key}`, `team:${brand.team}`, `env:${ENV_TAG}`, 'slo_type:availability'],
        }
      );
      if (result) createdSlos.push({ brand: brand.key, type: 'availability', id: result.data?.id || result.id });
    } else {
      console.log(`  ⚠  Skipping ${brand.name} POS Availability — monitor not found (run setup-datadog.js first)`);
    }

    if (latId) {
      const result = await create(
        `⏱  ${brand.name}: POS Latency`,
        '/api/v1/slo',
        {
          name:        `[${brand.name}] POS Latency SLO`,
          description: `Tracks the percentage of time ${brand.name} POS p95 processing latency stays below 1500ms. Fires when p95 latency exceeds the SLO threshold.`,
          type:        'monitor',
          monitor_ids: [latId],
          thresholds:  [
            { timeframe: '7d',  target: 99.0, warning: 99.5 },
            { timeframe: '30d', target: 99.0, warning: 99.5 },
          ],
          tags: [`service:${SERVICE}`, `brand:${brand.key}`, `team:${brand.team}`, `env:${ENV_TAG}`, 'slo_type:latency'],
        }
      );
      if (result) createdSlos.push({ brand: brand.key, type: 'latency', id: result.data?.id || result.id });
    } else {
      console.log(`  ⚠  Skipping ${brand.name} POS Latency — monitor not found`);
    }
  }

  // ── Platform-wide SLOs ────────────────────────────────────────────────────
  console.log('\n─── Platform-Wide SLOs ─────────────────────────────────────\n');

  const platformErrName  = `[${SERVICE}] Platform-Wide Error Rate — All Brands`;
  const loyaltyErrName   = `[${SERVICE}] Loyalty Service — Elevated Error Rate (All Brands)`;
  const deliveryEtaName  = `[${SERVICE}] Delivery ETA p95 > 60 minutes`;

  const platformErrId = platformMonitors[platformErrName];
  const loyaltyErrId  = platformMonitors[loyaltyErrName];
  const deliveryEtaId = platformMonitors[deliveryEtaName];

  if (platformErrId) {
    const result = await create(
      `🌐 Platform Availability`,
      '/api/v1/slo',
      {
        name:        `[${SERVICE}] Platform Availability`,
        description: `Tracks overall platform HTTP 500 error rate across all ${CUSTOMER.company} brands. Target: fewer than 20 HTTP 500s per 5-minute window.`,
        type:        'monitor',
        monitor_ids: [platformErrId],
        thresholds:  [
          { timeframe: '7d',  target: 99.9, warning: 99.95 },
          { timeframe: '30d', target: 99.9, warning: 99.95 },
        ],
        tags: [`service:${SERVICE}`, `team:${CUSTOMER.platformTeam}`, `env:${ENV_TAG}`, 'slo_type:availability', 'scope:platform'],
      }
    );
    if (result) createdSlos.push({ brand: 'platform', type: 'availability', id: result.data?.id || result.id });
  } else {
    console.log(`  ⚠  Skipping Platform Availability — monitor not found`);
  }

  if (loyaltyErrId) {
    const result = await create(
      `💛 Loyalty Service Health`,
      '/api/v1/slo',
      {
        name:        `[${SERVICE}] Loyalty Service Health`,
        description: `Cross-brand loyalty service availability. Tracks the percentage of time loyalty lookup errors stay below threshold (affects all 6 brands simultaneously).`,
        type:        'monitor',
        monitor_ids: [loyaltyErrId],
        thresholds:  [
          { timeframe: '7d',  target: 99.9, warning: 99.95 },
          { timeframe: '30d', target: 99.9, warning: 99.95 },
        ],
        tags: [`service:${SERVICE}`, `team:${CUSTOMER.platformTeam}`, `env:${ENV_TAG}`, 'slo_type:availability', 'scope:shared-service'],
      }
    );
    if (result) createdSlos.push({ brand: 'platform', type: 'loyalty', id: result.data?.id || result.id });
  } else {
    console.log(`  ⚠  Skipping Loyalty Service Health — monitor not found`);
  }

  if (deliveryEtaId) {
    const result = await create(
      `🚚 Delivery SLA`,
      '/api/v1/slo',
      {
        name:        `[${SERVICE}] Delivery ETA SLA`,
        description: `Cross-brand delivery SLA. Tracks the percentage of time delivery p95 ETA stays at or below 60 minutes across all brands.`,
        type:        'monitor',
        monitor_ids: [deliveryEtaId],
        thresholds:  [
          { timeframe: '7d',  target: 95.0, warning: 97.0 },
          { timeframe: '30d', target: 95.0, warning: 97.0 },
        ],
        tags: [`service:${SERVICE}`, `team:${CUSTOMER.platformTeam}`, `env:${ENV_TAG}`, 'slo_type:latency', 'scope:shared-service'],
      }
    );
    if (result) createdSlos.push({ brand: 'platform', type: 'delivery', id: result.data?.id || result.id });
  } else {
    console.log(`  ⚠  Skipping Delivery SLA — monitor not found`);
  }

  // ── Append SLO widget to exec dashboard ───────────────────────────────────
  const assetsPath = path.join(__dirname, 'app', 'public', 'dd-assets.json');
  if (createdSlos.length > 0 && fs.existsSync(assetsPath)) {
    console.log('\n─── Updating Exec Dashboard ─────────────────────────────────\n');

    try {
      const assets    = JSON.parse(fs.readFileSync(assetsPath, 'utf8'));
      const dashId    = assets?.dashboards?.platform;

      if (dashId) {
        // Fetch current dashboard
        const fetchRes = await ddRequest('GET', `/api/v1/dashboard/${dashId}`, null);
        if (fetchRes.status === 200) {
          const dash    = fetchRes.data;
          const widgets = dash.widgets || [];

          // Only add if not already present
          const alreadyHasSloWidget = widgets.some(w => w.definition?.type === 'slo_list');
          if (!alreadyHasSloWidget) {
            // Find the max y-position to append below existing content
            const maxY = widgets.reduce((m, w) => {
              const bottom = (w.layout?.y || 0) + (w.layout?.height || 2);
              return Math.max(m, bottom);
            }, 0);

            widgets.push({
              definition: {
                type:  'slo_list',
                title: `${CUSTOMER.company} — SLO Status`,
                query: {
                  query_string: `service:${SERVICE}`,
                  limit:        20,
                },
              },
              layout: { x: 0, y: maxY, width: 12, height: 5 },
            });

            process.stdout.write('  📊 Adding SLO list widget to exec dashboard... ');
            const putRes = await ddRequest('PUT', `/api/v1/dashboard/${dashId}`, {
              title:       dash.title,
              description: dash.description,
              layout_type: dash.layout_type,
              tags:        dash.tags || [],
              widgets,
            });
            if (putRes.status === 200) {
              console.log('✅');
            } else {
              console.log(`✗  HTTP ${putRes.status}: ${JSON.stringify(putRes.data).substring(0, 200)}`);
            }
          } else {
            console.log('  ℹ  SLO list widget already present on exec dashboard — skipping');
          }
        } else {
          console.log(`  ⚠  Could not fetch exec dashboard (HTTP ${fetchRes.status}) — skipping widget update`);
        }
      } else {
        console.log('  ⚠  No exec dashboard ID in dd-assets.json — run setup-datadog.js first');
      }

      // Save SLO IDs and URL to dd-assets.json
      assets.slos    = createdSlos;
      assets.urls    = assets.urls || {};
      assets.urls.slos = `https://app.${SITE}/slos`;
      fs.writeFileSync(assetsPath, JSON.stringify(assets, null, 2));
      console.log(`\n  📎 SLO IDs saved → ${assetsPath}`);
    } catch (e) {
      console.log(`  ⚠  Could not update dd-assets.json: ${e.message}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const sloCount = createdSlos.length;
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  ✅  ${sloCount} SLOs created                                     ║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`  📊 View all SLOs  → https://app.${SITE}/slos`);
  console.log(`  🔍 Filter by tag  → https://app.${SITE}/slos?query=service%3A${SERVICE}`);
  console.log('');
  console.log('  SLO targets:');
  console.log('    Per-brand POS Availability  99.5% over 30d  (≈ 3.6 h/month error budget)');
  console.log('    Per-brand POS Latency       99.0% over  7d  (≈ 1.7 h/week  latency budget)');
  console.log('    Platform Availability       99.9% over 30d  (≈ 43 min/month error budget)');
  console.log('    Loyalty Service Health      99.9% over 30d  (≈ 43 min/month error budget)');
  console.log('    Delivery SLA                95.0% over  7d  (≈ 8.4 h/week  ETA budget)');
  console.log('');
  console.log('  Tip: trigger a POS outage from the demo UI to watch the error budget burn in real time.');
  console.log('');
}

main().catch(err => { console.error('\n✗ Fatal:', err.message); process.exit(1); });
