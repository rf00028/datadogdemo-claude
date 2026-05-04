#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// setup-ownership.js — Inspire Brands × Datadog — Ownership & Scorecards Setup
//
// Creates:
//   1. Fetches current user UUID (for on-call schedule membership)
//   2. Creates "Production Readiness" Scorecard with 6 rules + sets outcomes
//      for all 19 services
//   3. Creates per-brand + platform on-call schedules
//   4. Re-registers all 19 service definitions with contacts populated
//
// Requirements: DD_API_KEY + DD_APP_KEY in .env
// Run: node setup-ownership.js
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

const CUSTOMER  = require('./app/customer.config');
const API_KEY   = process.env.DD_API_KEY;
const APP_KEY   = process.env.DD_APP_KEY;
const SITE      = process.env.DD_SITE || 'datadoghq.com';
const SERVICE   = CUSTOMER.platform;
const SVC_PFX   = CUSTOMER.servicePrefix;
const ENV_TAG   = process.env.DD_ENV || 'local';

if (!API_KEY || API_KEY === 'your_api_key_here') {
  console.error('\n✗  DD_API_KEY missing in .env\n'); process.exit(1);
}
if (!APP_KEY || APP_KEY === 'your_app_key_here') {
  console.error('\n✗  DD_APP_KEY missing in .env');
  console.error(`   Get it at: https://app.${SITE}/organization-settings/application-keys\n`);
  process.exit(1);
}

// ── Brand definitions ────────────────────────────────────────────────────────
const BRANDS = CUSTOMER.brands;

// ── All 19 services ───────────────────────────────────────────────────────────
// 1 platform + (3 × 6 brands) = 19
function buildServiceList() {
  const services = [{ name: SERVICE, brand: null }];
  for (const brand of BRANDS) {
    services.push({ name: `${SVC_PFX}-${brand.key}-pos`,      brand });
    services.push({ name: `${SVC_PFX}-${brand.key}-loyalty`,  brand });
    services.push({ name: `${SVC_PFX}-${brand.key}-delivery`, brand });
  }
  return services;
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

async function create(label, method, urlPath, body) {
  process.stdout.write(`  ${label}... `);
  try {
    const res = await ddRequest(method, urlPath, body);
    if (res.status >= 200 && res.status < 300) {
      const id = res.data?.data?.id || res.data?.id || res.data?.public_id || '—';
      console.log(`✅  (id: ${id})`);
      return res.data;
    }
    const msg = JSON.stringify(res.data).substring(0, 400);
    console.log(`✗   HTTP ${res.status}: ${msg}`);
  } catch (e) {
    console.log(`✗   ${e.message}`);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  🏷️   Inspire Brands × Datadog — Ownership Setup          ║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  Site:    https://app.${SITE}`);
  console.log(`  Service: ${SERVICE}  •  Env: ${ENV_TAG}`);
  console.log(`  Brands:  ${BRANDS.map(b => b.key).join(', ')}\n`);

  // ── STEP 1: Get current user UUID ─────────────────────────────────────────
  console.log('─── Step 1: Current User ───────────────────────────────────\n');

  let currentUserUUID = null;
  process.stdout.write('  Fetching current user UUID... ');
  try {
    const res = await ddRequest('GET', '/api/v2/current_user', null);
    if (res.status === 200 && res.data?.data?.id) {
      currentUserUUID = res.data.data.id;
      console.log(`✅  (uuid: ${currentUserUUID})`);
    } else {
      console.log(`✗   HTTP ${res.status}: ${JSON.stringify(res.data).substring(0, 200)}`);
      console.log('  ⚠  Proceeding without user UUID — on-call schedules will have no members\n');
    }
  } catch (e) {
    console.log(`✗   ${e.message}`);
    console.log('  ⚠  Proceeding without user UUID — on-call schedules will have no members\n');
  }

  // ── STEP 2: Scorecards ────────────────────────────────────────────────────
  console.log('\n─── Step 2: Production Readiness Scorecard ─────────────────\n');

  const SCORECARD_NAME = 'Production Readiness';

  const RULES = [
    {
      name:        'Has APM Instrumentation',
      description: 'Service emits traces and runtime metrics',
    },
    {
      name:        'Has Error Rate Monitor',
      description: 'Active monitor on POS/service error rate',
    },
    {
      name:        'Has Latency SLO',
      description: 'p95 latency SLO defined and active',
    },
    {
      name:        'Has On-Call Rotation',
      description: 'Service has an active on-call schedule',
    },
    {
      name:        'Has Team Ownership',
      description: 'Service is assigned to an owning team in Service Catalog',
    },
    {
      name:        'Has Runbook / Logs Link',
      description: 'Service catalog entry includes a logs or runbook link',
    },
  ];

  // Create all rules and collect their IDs
  const ruleIds = {};
  for (const rule of RULES) {
    const result = await create(
      `📋 Rule: ${rule.name}`,
      'POST',
      '/api/v2/scorecard/rules',
      {
        data: {
          type: 'rule',
          attributes: {
            name:           rule.name,
            description:    rule.description,
            scorecard_name: SCORECARD_NAME,
            enabled:        true,
          },
        },
      }
    );
    if (result?.data?.id) {
      ruleIds[rule.name] = result.data.id;
    }
  }

  console.log(`\n  Rule IDs collected: ${Object.keys(ruleIds).length} / ${RULES.length}`);

  // Build all 19 services
  const ALL_SERVICES = buildServiceList();

  // Determine pass/fail per rule per service
  // All rules → pass for all services (per spec)
  function getState(ruleName, serviceName) {
    return 'pass';
  }

  // Set outcomes via batch endpoint — batch up to all 19 × 6 outcomes
  if (Object.keys(ruleIds).length > 0) {
    console.log('\n  Setting scorecard outcomes for all 19 services...');

    const results = [];
    for (const [ruleName, ruleId] of Object.entries(ruleIds)) {
      for (const svc of ALL_SERVICES) {
        results.push({
          rule_id:      ruleId,
          service_name: svc.name,
          state:        getState(ruleName, svc.name),
          remarks:      'Configured by setup-ownership.js',
        });
      }
    }

    // The API may have a limit per batch; send in chunks of 100
    const CHUNK_SIZE = 100;
    let batchNum = 0;
    for (let i = 0; i < results.length; i += CHUNK_SIZE) {
      batchNum++;
      const chunk = results.slice(i, i + CHUNK_SIZE);
      await create(
        `📊 Outcomes batch ${batchNum} (${chunk.length} outcomes)`,
        'POST',
        '/api/v2/scorecard/outcomes/batch',
        {
          data: {
            type: 'outcomes',
            attributes: {
              results: chunk,
            },
          },
        }
      );
    }
  } else {
    console.log('\n  ⚠  No rule IDs available — skipping outcomes batch');
  }

  // ── STEP 3: On-Call Schedules ──────────────────────────────────────────────
  console.log('\n─── Step 3: On-Call Schedules ──────────────────────────────\n');

  // All teams: brand teams + platform team
  const TEAMS = [
    ...BRANDS.map(b => ({ handle: b.team, label: b.name })),
    { handle: CUSTOMER.platformTeam, label: 'Inspire Platform Engineering' },
  ];

  const createdSchedules = [];

  for (const team of TEAMS) {
    // Fetch team UUID
    let teamUUID = null;
    process.stdout.write(`  Fetching UUID for team ${team.handle}... `);
    try {
      const res = await ddRequest('GET', `/api/v2/teams?filter[keyword]=${encodeURIComponent(team.handle)}`, null);
      if (res.status === 200 && res.data?.data?.length > 0) {
        teamUUID = res.data.data[0].id;
        console.log(`✅  (uuid: ${teamUUID})`);
      } else {
        console.log(`✗   HTTP ${res.status} or no results — skipping schedule for ${team.handle}`);
        continue;
      }
    } catch (e) {
      console.log(`✗   ${e.message} — skipping schedule for ${team.handle}`);
      continue;
    }

    // Build layer members
    const members = currentUserUUID
      ? [{ user: { id: currentUserUUID, type: 'users' } }]
      : [];

    // Create the schedule
    const scheduleName = `${team.label} On-Call Rotation`;
    const result = await create(
      `📅 Schedule: ${scheduleName}`,
      'POST',
      '/api/v2/on-call/schedules',
      {
        data: {
          type: 'schedules',
          attributes: {
            name:      scheduleName,
            time_zone: 'America/Chicago',
            teams:     [{ id: teamUUID, type: 'teams' }],
            layers: [
              {
                name:          'Primary',
                start:         '2024-01-01T00:00:00Z',
                end:           null,
                rotation_type: 'weekly',
                restrictions:  [],
                members,
              },
            ],
          },
        },
      }
    );

    if (result?.data?.id) {
      createdSchedules.push({ label: scheduleName, id: result.data.id });
    }
  }

  // ── STEP 4: Update Service Definitions with contacts ──────────────────────
  console.log('\n─── Step 4: Service Definitions (contacts) ─────────────────\n');

  // Platform service
  await create(
    `🌐 Service Catalog: ${SERVICE}`,
    'POST',
    '/api/v2/services/definitions',
    {
      'schema-version': 'v2.2',
      'dd-service':     SERVICE,
      team:             CUSTOMER.platformTeam,
      description:      `Multi-brand digital platform serving ${CUSTOMER.company} brands. Routes requests to brand-specific services.`,
      type:             'web',
      tier:             'High',
      languages:        ['JavaScript'],
      tags:             [
        `team:${CUSTOMER.platformTeam}`,
        'env:local',
        `cost_center:${SERVICE}`,
        'business_unit:platform',
      ],
      links: [
        { name: 'APM Service', type: 'other',     url: `https://app.${SITE}/apm/services/${SERVICE}?env=${ENV_TAG}` },
        { name: 'Logs',        type: 'other',     url: `https://app.${SITE}/logs?query=service%3A${SERVICE}` },
        { name: 'Profiles',    type: 'other',     url: `https://app.${SITE}/profiling?service=${SERVICE}&env=${ENV_TAG}` },
      ],
      contacts: [
        { name: 'Ops Email', type: 'email', contact: 'platform@inspire.example.com' },
        { name: 'Slack',     type: 'slack', contact: '#inspire-platform' },
      ],
    }
  );

  // Per-brand services
  const SERVICE_TYPES = ['pos', 'loyalty', 'delivery'];

  const SERVICE_TYPE_META = {
    pos: {
      description: (b) =>
        `${b.name} Point of Sale — processes orders, manages transactions, and handles payment flow across drive-thru, dine-in, and delivery channels.`,
      tier: 'High',
    },
    loyalty: {
      description: (b) =>
        `${b.name} Loyalty Program — member lookups, points balance, tier management (Bronze / Silver / Gold), and reward redemptions.`,
      tier: 'High',
    },
    delivery: {
      description: (b) =>
        `${b.name} Delivery Service — delivery partner integration, ETA estimation, and order routing for third-party delivery channels.`,
      tier: 'High',
    },
  };

  for (const brand of BRANDS) {
    for (const suffix of SERVICE_TYPES) {
      const ddService = `${SVC_PFX}-${brand.key}-${suffix}`;
      const meta      = SERVICE_TYPE_META[suffix];

      await create(
        `📦 ${brand.name}: ${suffix}`,
        'POST',
        '/api/v2/services/definitions',
        {
          'schema-version': 'v2.2',
          'dd-service':     ddService,
          team:             brand.team,
          description:      meta.description(brand),
          type:             'web',
          tier:             meta.tier,
          languages:        ['JavaScript'],
          tags: [
            `team:${brand.team}`,
            `brand:${brand.key}`,
            'env:local',
            `cost_center:${brand.key}`,
            `business_unit:${brand.key}`,
          ],
          links: [
            { name: 'APM Traces', type: 'other', url: `https://app.${SITE}/apm/traces?query=service:${ddService}+env:${ENV_TAG}` },
            { name: 'Logs',       type: 'other', url: `https://app.${SITE}/logs?query=service%3A${ddService}` },
            { name: 'Profiles',   type: 'other', url: `https://app.${SITE}/profiling?service=${ddService}&env=${ENV_TAG}` },
          ],
          contacts: [
            { name: 'Ops Email', type: 'email', contact: `${brand.key}-ops@inspire.example.com` },
            { name: 'Slack',     type: 'slack', contact: `#inspire-${brand.key}-ops` },
          ],
        }
      );
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✅  Ownership setup complete!                            ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`  📋 Scorecards      → https://app.${SITE}/software-catalog/scorecards`);
  console.log(`  📅 On-Call         → https://app.${SITE}/on-call`);
  console.log(`  📦 Svc Catalog     → https://app.${SITE}/services`);
  console.log(`  🏢 Teams           → https://app.${SITE}/organization-settings/teams`);
  console.log('');

  if (createdSchedules.length > 0) {
    console.log('  On-call schedules created:');
    for (const s of createdSchedules) {
      console.log(`    • ${s.label} (id: ${s.id})`);
    }
    console.log('');
  }

  console.log('  Scorecard rules created:');
  for (const [name, id] of Object.entries(ruleIds)) {
    console.log(`    • ${name} (id: ${id})`);
  }
  console.log('');

  const totalServices = ALL_SERVICES.length;
  const totalOutcomes = Object.keys(ruleIds).length * totalServices;
  console.log(`  Outcomes set: ${totalOutcomes} (${Object.keys(ruleIds).length} rules × ${totalServices} services)`);
  console.log('');
}

main().catch(err => { console.error('\n✗ Fatal:', err.message); process.exit(1); });
