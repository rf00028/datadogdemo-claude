#!/usr/bin/env node
'use strict';

const fs    = require('fs');
const https = require('https');

try {
  fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
} catch {}

const API_KEY = process.env.DD_API_KEY;
const APP_KEY = process.env.DD_APP_KEY;
const SITE    = process.env.DD_SITE || 'datadoghq.com';
const ENV_TAG = process.env.DD_ENV  || 'local';

function ddRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: `api.${SITE}`,
      path,
      method,
      headers: {
        'Content-Type':       'application/json',
        'DD-API-KEY':         API_KEY,
        'DD-APPLICATION-KEY': APP_KEY,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// All alert monitors with their brand context
const MONITOR_UPDATES = [
  // ── Arby's ──────────────────────────────────────────────────────────
  {
    id: 278288073,
    brand: "Arby's", key: 'arbys', team: 'arbys-ops', dashId: 'f75-z6m-tar',
    slack: '#arbys-ops-alerts', pagerduty: 'arbys-oncall',
    type: 'pos-errors', severity: 'P2',
    title: 'POS Error Rate Elevated',
    triage: [
      'Check POS terminal connectivity: `curl http://localhost:3000/api/arbys/orders`',
      'Review error logs for payment gateway timeouts',
      'Verify Stripe/payment processor status page',
      'If error rate >20%: escalate to platform team',
    ],
  },
  {
    id: 278288099,
    brand: "Arby's", key: 'arbys', team: 'arbys-ops', dashId: 'f75-z6m-tar',
    slack: '#arbys-ops-alerts', pagerduty: 'arbys-oncall',
    type: 'pos-latency', severity: 'P3',
    title: 'POS p95 Latency Degraded',
    triage: [
      'Check for slow-pos feature flag active in demo UI',
      'Review DB query times in APM → Database Calls',
      'Check CPU/memory on POS service containers',
      'Verify no upstream dependency latency spikes',
    ],
  },
  {
    id: 278288363,
    brand: "Arby's", key: 'arbys', team: 'arbys-ops', dashId: 'f75-z6m-tar',
    slack: '#arbys-ops-alerts', pagerduty: 'arbys-oncall',
    type: 'order-anomaly', severity: 'P3',
    title: 'Anomalous Order Volume',
    triage: [
      'Check for active marketing promotions or flash sales',
      'Verify POS is accepting orders (not a false-positive drop)',
      'Review traffic sources in logs for bot/scraper activity',
      'Coordinate with marketing team on planned events',
    ],
  },

  // ── Buffalo Wild Wings ───────────────────────────────────────────────
  {
    id: 278288100,
    brand: 'Buffalo Wild Wings', key: 'bww', team: 'bww-ops', dashId: 'q5d-bjs-bse',
    slack: '#bww-ops-alerts', pagerduty: 'bww-oncall',
    type: 'pos-errors', severity: 'P2',
    title: 'POS Error Rate Elevated',
    triage: [
      'Verify dine-in and takeout POS terminals are online',
      'Check payment processor (Square/Toast) status page',
      'Review APM traces filtered to brand:bww + error:true',
      'Check for recent deployments in the past 30 minutes',
    ],
  },
  {
    id: 278288102,
    brand: 'Buffalo Wild Wings', key: 'bww', team: 'bww-ops', dashId: 'q5d-bjs-bse',
    slack: '#bww-ops-alerts', pagerduty: 'bww-oncall',
    type: 'pos-latency', severity: 'P3',
    title: 'POS p95 Latency Degraded',
    triage: [
      'Check game-day traffic patterns — high-traffic events cause natural spikes',
      'Review DB connection pool utilization',
      'Verify kitchen display systems are not causing order hold-ups',
      'Check third-party beer/tab management integration latency',
    ],
  },
  {
    id: 278288378,
    brand: 'Buffalo Wild Wings', key: 'bww', team: 'bww-ops', dashId: 'q5d-bjs-bse',
    slack: '#bww-ops-alerts', pagerduty: 'bww-oncall',
    type: 'order-anomaly', severity: 'P3',
    title: 'Anomalous Order Volume',
    triage: [
      'Cross-reference with sports schedule — major game events drive volume spikes',
      'Check if wing promotion or Happy Hour is running',
      'Review delivery partner integrations (DoorDash, Uber Eats)',
      'Alert is expected during Super Bowl, playoffs, and UFC events',
    ],
  },

  // ── Sonic Drive-In ──────────────────────────────────────────────────
  {
    id: 278288103,
    brand: 'Sonic Drive-In', key: 'sonic', team: 'sonic-ops', dashId: 'nxt-4cb-fca',
    slack: '#sonic-ops-alerts', pagerduty: 'sonic-oncall',
    type: 'pos-errors', severity: 'P2',
    title: 'POS Error Rate Elevated',
    triage: [
      'Check drive-in stall intercom/ordering system connectivity',
      'Verify SONIC app mobile ordering endpoint health',
      'Review payment terminal firmware update status',
      'Check for issues with carhop assignment system integration',
    ],
  },
  {
    id: 278288104,
    brand: 'Sonic Drive-In', key: 'sonic', team: 'sonic-ops', dashId: 'nxt-4cb-fca',
    slack: '#sonic-ops-alerts', pagerduty: 'sonic-oncall',
    type: 'pos-latency', severity: 'P3',
    title: 'POS p95 Latency Degraded',
    triage: [
      'Happy Hour (2-4pm) drives 3× normal traffic — latency spike may be expected',
      'Check Route 44 drink station integration for kitchen delays',
      'Verify drive-in ordering hardware is not queuing requests',
      'Review APM flame graph for slow DB queries on menu catalog',
    ],
  },
  {
    id: 278288403,
    brand: 'Sonic Drive-In', key: 'sonic', team: 'sonic-ops', dashId: 'nxt-4cb-fca',
    slack: '#sonic-ops-alerts', pagerduty: 'sonic-oncall',
    type: 'order-anomaly', severity: 'P3',
    title: 'Anomalous Order Volume',
    triage: [
      'Check Happy Hour schedule — 50% off slushes drives major volume spikes',
      'Review SONIC app promo code redemption rates',
      'Verify this is not a carhop offline event causing order drop',
      'Coordinate with field ops on weather events (Sonic is drive-in only)',
    ],
  },

  // ── Dunkin' ──────────────────────────────────────────────────────────
  {
    id: 278288105,
    brand: "Dunkin'", key: 'dunkin', team: 'dunkin-ops', dashId: 'yd2-vab-79j',
    slack: '#dunkin-ops-alerts', pagerduty: 'dunkin-oncall',
    type: 'pos-errors', severity: 'P2',
    title: 'POS Error Rate Elevated',
    triage: [
      'Morning rush (6-9am) is highest-risk window — check POS queue depth',
      'Verify Dunkin\' mobile order pickup integration is not timing out',
      'Check loyalty app redemption endpoint (DD Perks) for errors',
      'Review drive-thru vs in-store error split in logs',
    ],
  },
  {
    id: 278288106,
    brand: "Dunkin'", key: 'dunkin', team: 'dunkin-ops', dashId: 'yd2-vab-79j',
    slack: '#dunkin-ops-alerts', pagerduty: 'dunkin-oncall',
    type: 'pos-latency', severity: 'P3',
    title: 'POS p95 Latency Degraded',
    triage: [
      'Check espresso machine IoT integration latency during morning rush',
      'Review mobile order ahead queue — high volume causes POS hold',
      'Verify bakery delivery truck arrival events are not flooding events table',
      'Check Dunkin\' rewards point calculation service response times',
    ],
  },
  {
    id: 278288415,
    brand: "Dunkin'", key: 'dunkin', team: 'dunkin-ops', dashId: 'yd2-vab-79j',
    slack: '#dunkin-ops-alerts', pagerduty: 'dunkin-oncall',
    type: 'order-anomaly', severity: 'P3',
    title: 'Anomalous Order Volume',
    triage: [
      'Free coffee Monday promotions will trigger expected volume spikes',
      'Check for National Coffee Day or seasonal drink launch campaigns',
      'A drop in volume during 6-9am is a P1 — Dunkin\' lives on morning traffic',
      'Review mobile order vs in-store split to isolate the anomaly source',
    ],
  },

  // ── Baskin-Robbins ──────────────────────────────────────────────────
  {
    id: 278288107,
    brand: 'Baskin-Robbins', key: 'baskin-robbins', team: 'br-ops', dashId: 'mu7-y5j-aw3',
    slack: '#br-ops-alerts', pagerduty: 'baskin-robbins-oncall',
    type: 'pos-errors', severity: 'P2',
    title: 'POS Error Rate Elevated',
    triage: [
      'Check ice cream cake pre-order fulfillment system for deadlocks',
      'Verify Baskin-Robbins 31 flavors menu API is returning current inventory',
      'Review catering order portal for payment processing errors',
      'Check if store-level freezer temperature monitoring is sending false alerts',
    ],
  },
  {
    id: 278288109,
    brand: 'Baskin-Robbins', key: 'baskin-robbins', team: 'br-ops', dashId: 'mu7-y5j-aw3',
    slack: '#br-ops-alerts', pagerduty: 'baskin-robbins-oncall',
    type: 'pos-latency', severity: 'P3',
    title: 'POS p95 Latency Degraded',
    triage: [
      'Summer months: elevated traffic is expected — check if latency is proportional',
      'Review cake customization order builder API response times',
      'Check online pre-order pickup queue depth',
      'Verify flavor availability sync from store inventory system is not blocking orders',
    ],
  },
  {
    id: 278288416,
    brand: 'Baskin-Robbins', key: 'baskin-robbins', team: 'br-ops', dashId: 'mu7-y5j-aw3',
    slack: '#br-ops-alerts', pagerduty: 'baskin-robbins-oncall',
    type: 'order-anomaly', severity: 'P3',
    title: 'Anomalous Order Volume',
    triage: [
      '31¢ scoop night (April) will cause extreme volume spikes — expected',
      'Check for birthday cake catering order batch imports',
      'Review holiday ice cream cake pre-orders (Thanksgiving, Christmas)',
      'Summer heat waves directly correlate with volume spikes',
    ],
  },

  // ── Jimmy John's ────────────────────────────────────────────────────
  {
    id: 278288115,
    brand: "Jimmy John's", key: 'jimmy-johns', team: 'jj-ops', dashId: 'tap-3s5-x26',
    slack: '#jj-ops-alerts', pagerduty: 'jj-oncall',
    type: 'pos-errors', severity: 'P2',
    title: 'POS Error Rate Elevated',
    triage: [
      '"Freaky Fast" SLA requires <5% error rate — this breach needs immediate action',
      'Check delivery driver assignment API for routing failures',
      'Review in-house delivery system integration vs third-party partners',
      'Verify bread bake schedule tracking system is not impacting orders',
    ],
  },
  {
    id: 278288116,
    brand: "Jimmy John's", key: 'jimmy-johns', team: 'jj-ops', dashId: 'tap-3s5-x26',
    slack: '#jj-ops-alerts', pagerduty: 'jj-oncall',
    type: 'pos-latency', severity: 'P3',
    title: 'POS p95 Latency Degraded',
    triage: [
      'Latency directly impacts "Freaky Fast" brand promise — treat as P2 during lunch rush',
      'Check driver routing algorithm response time',
      'Review sandwich customization option tree for slow DB lookups',
      'Verify catering quote engine is not blocking standard order flow',
    ],
  },
  {
    id: 278288417,
    brand: "Jimmy John's", key: 'jimmy-johns', team: 'jj-ops', dashId: 'tap-3s5-x26',
    slack: '#jj-ops-alerts', pagerduty: 'jj-oncall',
    type: 'order-anomaly', severity: 'P3',
    title: 'Anomalous Order Volume',
    triage: [
      'Lunch rush (11am-2pm) volume spikes are expected and healthy',
      'Free 8" sub promotions drive significant spikes — check promo calendar',
      'A volume DROP at lunch is a P2 — JJ\'s delivery-heavy model is time-sensitive',
      'Review delivery zone coverage map for service outages',
    ],
  },

  // ── Platform ─────────────────────────────────────────────────────────
  {
    id: 278288117,
    brand: 'Inspire Brands Platform', key: 'platform', team: 'inspire-platform', dashId: '3t7-6rx-4xc',
    slack: '#platform-oncall', pagerduty: 'platform-oncall',
    type: 'platform-errors', severity: 'P1',
    title: 'Platform-Wide Error Rate Elevated',
    triage: [
      'Check shared infrastructure health: load balancer, DB cluster, Redis cache',
      'Review if a single brand is causing the spike vs all-brand impact',
      'Check for recent deployments in the past hour across any brand service',
      'Escalate to VP Engineering if error rate >10% for more than 5 minutes',
    ],
  },
  {
    id: 278288119,
    brand: 'Inspire Brands Platform', key: 'platform', team: 'inspire-platform', dashId: '3t7-6rx-4xc',
    slack: '#platform-oncall', pagerduty: 'loyalty-oncall',
    type: 'loyalty-errors', severity: 'P2',
    title: 'Loyalty Service Degraded — All Brands Impacted',
    triage: [
      'Loyalty DB connection pool is the most common root cause — check pool utilization',
      'All 6 brands\' loyalty programs are affected simultaneously',
      'Check Redis loyalty cache hit rate — a cache flush causes immediate spike',
      'Review loyalty data pipeline sync lag — stale data causes lookup failures',
    ],
  },
  {
    id: 278288121,
    brand: 'Inspire Brands Platform', key: 'platform', team: 'inspire-platform', dashId: '3t7-6rx-4xc',
    slack: '#platform-oncall', pagerduty: 'delivery-oncall',
    type: 'delivery-eta', severity: 'P2',
    title: 'Delivery ETA Critically Elevated — All Brands',
    triage: [
      'Contact DoorDash/Uber Eats operations: 1-800-DOORDASH / ops@ubereats.com',
      'Check if delivery-surge feature flag is active in demo UI',
      'Review driver availability map for affected metropolitan areas',
      'Consider pausing delivery channel for affected brands to protect brand reputation',
    ],
  },
];

function buildTriageMessage(m) {
  const triageSteps = m.triage.map((step, i) => `${i + 1}. ${step}`).join('\n');

  return `{{#is_alert}}
## ${m.severity === 'P1' ? '🚨' : m.severity === 'P2' ? '🔴' : '🟡'} ${m.title} — ${m.brand}

**Severity**: ${m.severity} — Customer-Impacting
**Team**: \`${m.team}\`
**Slack**: ${m.slack}
**On-Call**: @${m.pagerduty}

**Immediate Triage:**
${triageSteps}

**Brand Dashboard**: https://app.${SITE}/dashboard/${m.dashId}
**APM Traces**: https://app.${SITE}/apm/traces?query=brand%3A${m.key}%20env%3A${ENV_TAG}
**Logs**: https://app.${SITE}/logs?query=brand%3A${m.key}%20status%3Aerror
**Runbook**: https://runbooks.inspire-brands.internal/${m.key}/${m.type}

**Escalation Path**:
→ ${m.slack} (L1 response <15 min)
→ @${m.pagerduty} (no response in 15 min)
→ #platform-oncall (P1/P2 only, no resolution in 30 min)
{{/is_alert}}
{{#is_recovery}}
✅ **Recovered** — ${m.brand} · ${m.title} is back to normal.
Verify in dashboard: https://app.${SITE}/dashboard/${m.dashId}
{{/is_recovery}}
{{#is_warning}}
⚠️ **Warning** — ${m.brand} · ${m.title} approaching threshold.
Monitor closely. Triage steps above apply if alert fires.
{{/is_warning}}`;
}

async function patchMonitor(m) {
  // GET current monitor
  const get = await ddRequest('GET', `/api/v1/monitor/${m.id}`);
  if (get.status !== 200) {
    console.warn(`  ✗ GET monitor ${m.id} failed: ${get.status}`);
    return;
  }

  const monitor = get.body;
  const newMessage = buildTriageMessage(m);

  // Build PUT payload (strip read-only fields)
  const payload = { ...monitor, message: newMessage };
  ['id', 'created', 'creator', 'deleted', 'org_id', 'overall_state', 'overall_state_modified',
   'matching_downtimes', 'modified', 'multi', 'restricted_roles'].forEach(k => delete payload[k]);

  const put = await ddRequest('PUT', `/api/v1/monitor/${m.id}`, payload);
  if (put.status === 200) {
    console.log(`  ✓ [${m.severity}] ${monitor.name}`);
  } else {
    console.warn(`  ✗ Failed ${monitor.name}: ${put.status}`, JSON.stringify(put.body).slice(0, 150));
  }
}

(async () => {
  console.log(`🔧 Patching triage info on ${MONITOR_UPDATES.length} monitors...\n`);
  for (const m of MONITOR_UPDATES) {
    await patchMonitor(m);
    await sleep(250);
  }
  console.log('\n✅ All monitors updated with runbooks, escalation paths, and brand-specific triage steps.');
})();
