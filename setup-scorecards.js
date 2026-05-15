#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// setup-scorecards.js — Inspire Brands × Datadog Scorecards
//
// Creates custom scorecard rules and sets realistic outcomes across all
// Inspire Brands services so the Service Catalog scorecard view is populated.
//
// Existing built-in scorecards (already in your org):
//   • Production Readiness      — SLOs, Monitors, On-call, Recent Deploy
//   • Observability Best Practices — Logs correlation, Deployment tracking
//   • Ownership & Documentation — Team, Contacts, Repos, Docs
//
// This script adds:
//   • Restaurant Operations Readiness — QSR-specific custom rules
//
// Run: node setup-scorecards.js
// ─────────────────────────────────────────────────────────────────────────────

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

// ── Load .env ────────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const idx = t.indexOf('=');
    if (idx === -1) return;
    process.env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  });
}

const API_KEY = process.env.DD_API_KEY;
const APP_KEY = process.env.DD_APP_KEY;
const SITE    = process.env.DD_SITE || 'datadoghq.com';

if (!API_KEY || !APP_KEY) {
  console.error('ERROR: DD_API_KEY and DD_APP_KEY are required.');
  process.exit(1);
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function ddRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: `api.${SITE}`,
      path:     urlPath,
      method,
      headers: {
        'DD-API-KEY':         API_KEY,
        'DD-APPLICATION-KEY': APP_KEY,
        'Content-Type':       'application/json',
        'Accept':             'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Services ─────────────────────────────────────────────────────────────────
const PLATFORM_SVC = 'inspire-brands-platform';
const BRAND_SVCS = [
  { service: 'inspire-arbys-pos',        brand: 'arbys',          tier: 'high'   },
  { service: 'inspire-arbys-loyalty',    brand: 'arbys',          tier: 'medium' },
  { service: 'inspire-bww-pos',          brand: 'bww',            tier: 'high'   },
  { service: 'inspire-bww-loyalty',      brand: 'bww',            tier: 'medium' },
  { service: 'inspire-sonic-pos',        brand: 'sonic',          tier: 'high'   },
  { service: 'inspire-sonic-loyalty',    brand: 'sonic',          tier: 'medium' },
  { service: 'inspire-dunkin-pos',       brand: 'dunkin',         tier: 'high'   },
  { service: 'inspire-dunkin-loyalty',   brand: 'dunkin',         tier: 'medium' },
  { service: 'inspire-br-pos',           brand: 'baskin-robbins', tier: 'high'   },
  { service: 'inspire-br-loyalty',       brand: 'baskin-robbins', tier: 'medium' },
  { service: 'inspire-jj-pos',           brand: 'jimmy-johns',    tier: 'high'   },
  { service: 'inspire-jj-loyalty',       brand: 'jimmy-johns',    tier: 'medium' },
];

// ── Custom rule definitions ───────────────────────────────────────────────────
const CUSTOM_RULES = [
  {
    name:           'POS error rate monitor defined',
    description:    'Every POS service must have a dedicated error rate monitor to detect order failures before they impact guests.',
    scorecard_name: 'Restaurant Operations Readiness',
    category:       'Reliability',
  },
  {
    name:           'p95 latency monitor defined',
    description:    'Order throughput services must have a p95 latency monitor. Guest-facing latency above 1500ms degrades conversion.',
    scorecard_name: 'Restaurant Operations Readiness',
    category:       'Performance',
  },
  {
    name:           'Order success rate SLO exists',
    description:    'Each brand must have an order success rate SLO with at least 99.5% target to meet franchise agreement SLAs.',
    scorecard_name: 'Restaurant Operations Readiness',
    category:       'Reliability',
  },
  {
    name:           'Multi-channel traffic instrumented',
    description:    'Services must emit metrics tagged by channel (in-store, drive-thru, delivery, mobile-order) for channel health visibility.',
    scorecard_name: 'Restaurant Operations Readiness',
    category:       'Observability',
  },
  {
    name:           'Chaos scenario tested in last 30 days',
    description:    'Teams must run at least one chaos scenario (payment timeout, loyalty outage, etc.) each month to validate resilience.',
    scorecard_name: 'Restaurant Operations Readiness',
    category:       'Resilience',
  },
];

// ── Outcome logic ─────────────────────────────────────────────────────────────
// Returns {state, remarks} for a given rule + service combination.
function outcomeFor(ruleName, service, brand) {
  const isSonic  = brand === 'sonic';
  const isJJ     = brand === 'jimmy-johns';
  const isBR     = brand === 'baskin-robbins';
  const isPos    = service.endsWith('-pos');
  const isLoyalty = service.endsWith('-loyalty');

  // Built-in rule outcomes
  if (ruleName === 'SLOs Defined') {
    if (isSonic)  return { state: 'fail', remarks: 'SLO creation blocked — Sonic POS incident ongoing' };
    return { state: 'pass', remarks: 'Error budget SLO defined at 99.5% target' };
  }
  if (ruleName === 'Monitors Defined') {
    return { state: 'pass', remarks: 'POS error rate + p95 latency + anomaly detection monitors active' };
  }
  if (ruleName === 'On-call Defined') {
    if (isJJ)    return { state: 'fail', remarks: 'On-call rotation not yet migrated to PagerDuty' };
    if (isBR && isLoyalty) return { state: 'skip', remarks: 'Low-tier service — on-call not required' };
    return { state: 'pass', remarks: 'PagerDuty on-call rotation configured for team' };
  }
  if (ruleName === 'Deployed in the past 3 months') {
    return { state: 'pass', remarks: 'Last deploy < 72h ago via CI/CD pipeline' };
  }
  if (ruleName === 'Logs correlation is active') {
    if (isSonic && isPos) return { state: 'fail', remarks: 'Log injection misconfigured after v2.3 rollout' };
    return { state: 'pass', remarks: 'dd-trace logInjection enabled — trace_id injected in all logs' };
  }
  if (ruleName === 'Deployment tracking is active') {
    if (isJJ)   return { state: 'fail', remarks: 'Deployment events not configured in CI pipeline' };
    return { state: 'pass', remarks: 'DD_VERSION set per deploy; deployment events sent via CI' };
  }
  if (ruleName === 'Team Defined') {
    return { state: 'pass', remarks: `Owned by ${brand}-ops team in Service Catalog` };
  }
  if (ruleName === 'Contacts Defined') {
    if (isBR)   return { state: 'fail', remarks: 'Slack + PagerDuty contacts not yet added to catalog entry' };
    return { state: 'pass', remarks: 'Slack channel + on-call contact defined' };
  }
  if (ruleName === 'Code Repos Defined') {
    if (isJJ)   return { state: 'fail', remarks: 'Repo link missing from Service Catalog entry' };
    return { state: 'pass', remarks: 'GitHub repo linked in Service Catalog' };
  }
  if (ruleName === 'Docs Defined') {
    if (isSonic) return { state: 'fail', remarks: 'Runbook outdated — last updated 6 months ago' };
    if (isBR && isLoyalty) return { state: 'fail', remarks: 'No runbook linked for loyalty service' };
    return { state: 'pass', remarks: 'Confluence runbook linked from Service Catalog' };
  }

  // Custom rule outcomes
  if (ruleName === 'POS error rate monitor defined') {
    if (!isPos) return { state: 'skip', remarks: 'Non-POS service — rule not applicable' };
    return { state: 'pass', remarks: 'POS error rate monitor active with p95 and anomaly detection' };
  }
  if (ruleName === 'p95 latency monitor defined') {
    if (!isPos) return { state: 'skip', remarks: 'Latency SLO applies to POS services only' };
    if (isSonic) return { state: 'fail', remarks: 'Latency monitor deleted during incident — needs recreation' };
    return { state: 'pass', remarks: 'p95 latency monitor set at 1500ms threshold' };
  }
  if (ruleName === 'Order success rate SLO exists') {
    if (isLoyalty) return { state: 'skip', remarks: 'Loyalty lookups tracked separately — not in order SLO scope' };
    if (isSonic)   return { state: 'fail', remarks: 'SLO breach in progress — error budget exhausted' };
    if (isJJ)      return { state: 'fail', remarks: 'SLO target not yet agreed with franchise ops team' };
    return { state: 'pass', remarks: '99.5% order success rate SLO — 14-day rolling window' };
  }
  if (ruleName === 'Multi-channel traffic instrumented') {
    if (isBR && isPos) return { state: 'fail', remarks: 'Online channel missing channel tag — catering orders untracked' };
    return { state: 'pass', remarks: 'All channels tagged: in-store, drive-thru, delivery, mobile-order' };
  }
  if (ruleName === 'Chaos scenario tested in last 30 days') {
    if (isJJ)        return { state: 'fail', remarks: 'No chaos tests run this month — team backlog prioritization' };
    if (isBR && isLoyalty) return { state: 'fail', remarks: 'Chaos testing skipped for low-traffic loyalty service' };
    return { state: 'pass', remarks: 'Payment timeout + loyalty outage scenarios validated this month' };
  }

  return { state: 'pass', remarks: 'Compliant' };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  🏆  Inspire Brands × Datadog — Scorecard Setup          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  Site:    https://app.${SITE}`);
  console.log(`  Service: ${PLATFORM_SVC}`);
  console.log(`  Brands:  ${[...new Set(BRAND_SVCS.map(s => s.brand))].join(', ')}\n`);

  // 1. Fetch existing rules
  console.log('─── Fetching existing rules ─────────────────────────────────\n');
  const existingResp = await ddRequest('GET', '/api/v2/scorecard/rules?page%5Bsize%5D=100');
  const existingRules = existingResp.body?.data || [];
  const rulesByName = {};
  existingRules.forEach(r => { rulesByName[r.attributes.name] = r.id; });
  console.log(`  Found ${existingRules.length} existing rules\n`);

  // 2. Create custom rules (skip if already exists)
  console.log('─── Custom Rules (Restaurant Operations Readiness) ──────────\n');
  const createdRuleIds = {};

  for (const rule of CUSTOM_RULES) {
    if (rulesByName[rule.name]) {
      createdRuleIds[rule.name] = rulesByName[rule.name];
      console.log(`  ⏭  "${rule.name}" — already exists`);
      continue;
    }
    const r = await ddRequest('POST', '/api/v2/scorecard/rules', {
      data: {
        type: 'rule',
        attributes: {
          name:           rule.name,
          description:    rule.description,
          enabled:        true,
          scorecard_name: rule.scorecard_name,
        },
      },
    });
    if (r.status === 201 || r.status === 200) {
      createdRuleIds[rule.name] = r.body.data.id;
      console.log(`  ✅  "${rule.name}"`);
    } else {
      console.log(`  ✗   "${rule.name}" — HTTP ${r.status}: ${JSON.stringify(r.body).slice(0,120)}`);
    }
  }

  // Merge all rule IDs (built-in + custom)
  const allRuleIds = { ...rulesByName, ...createdRuleIds };

  // 3. Set outcomes for all services
  console.log('\n─── Setting Outcomes ────────────────────────────────────────\n');

  const allServices = [
    { service: PLATFORM_SVC, brand: 'platform' },
    ...BRAND_SVCS,
  ];

  const allRuleNames = Object.keys(allRuleIds);
  const outcomes = [];

  for (const { service, brand } of allServices) {
    for (const ruleName of allRuleNames) {
      const ruleId = allRuleIds[ruleName];
      if (!ruleId) continue;
      const { state, remarks } = outcomeFor(ruleName, service, brand);
      outcomes.push({
        attributes: {
          service_name: service,
          rule_id:      ruleId,
          state,
          remarks,
        },
      });
    }
  }

  // Batch outcomes in chunks of 100
  const CHUNK = 100;
  let passed = 0, failed = 0, skipped = 0;
  for (let i = 0; i < outcomes.length; i += CHUNK) {
    const chunk = outcomes.slice(i, i + CHUNK);
    const results = chunk.map(o => ({
      rule_id:      o.attributes.rule_id,
      service_name: o.attributes.service_name,
      state:        o.attributes.state,
      remarks:      o.attributes.remarks,
    }));
    const r = await ddRequest('POST', '/api/v2/scorecard/outcomes/batch', {
      data: {
        type: 'batched-outcome',
        attributes: { results },
      },
    });
    if (r.status === 200 || r.status === 201) {
      chunk.forEach(o => {
        if      (o.attributes.state === 'pass') passed++;
        else if (o.attributes.state === 'fail') failed++;
        else                                     skipped++;
      });
    } else {
      console.log(`  ✗ Batch ${i}–${i+CHUNK} failed: HTTP ${r.status}`);
      console.log('   ', JSON.stringify(r.body).slice(0, 200));
    }
  }

  console.log(`  ✅  ${outcomes.length} outcomes set across ${allServices.length} services`);
  console.log(`      Pass: ${passed}  |  Fail: ${failed}  |  Skip: ${skipped}`);

  // 4. Update dd-assets.json
  console.log('\n─── Updating dd-assets.json ─────────────────────────────────\n');
  const assetsPath = path.join(__dirname, 'app', 'public', 'dd-assets.json');
  let assets = {};
  if (fs.existsSync(assetsPath)) {
    assets = JSON.parse(fs.readFileSync(assetsPath, 'utf8'));
  }
  assets.urls = assets.urls || {};
  assets.urls.scorecards = `https://app.${SITE}/catalog/scorecard`;
  fs.writeFileSync(assetsPath, JSON.stringify(assets, null, 2));
  console.log('  ✅  dd-assets.json updated\n');

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✅  Scorecard setup complete!                            ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  🏆 Scorecards  → https://app.${SITE}/catalog/scorecard`);
  console.log(`  📦 Service Cat → https://app.${SITE}/services\n`);
  console.log('  Failing services to highlight in demo:');
  console.log('    ⚠  sonic-pos      — logs correlation, latency monitor, order SLO');
  console.log('    ⚠  sonic-loyalty  — docs outdated');
  console.log('    ⚠  jj-pos         — on-call, deployment tracking, chaos testing');
  console.log('    ⚠  br-pos         — contacts, multi-channel tagging');
  console.log('    ⚠  br-loyalty     — chaos testing, docs\n');
}

main().catch(e => { console.error(e); process.exit(1); });
