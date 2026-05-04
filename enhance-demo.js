#!/usr/bin/env node
'use strict';

const fs    = require('fs');
const https = require('https');
const path  = require('path');

// Parse .env manually
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

if (!API_KEY || !APP_KEY) {
  console.error('DD_API_KEY and DD_APP_KEY are required in .env');
  process.exit(1);
}

// ── Brand config ──────────────────────────────────────────
const BRANDS = [
  {
    key:        'arbys',
    name:       "Arby's",
    team:       'arbys-ops',
    color:      '#E31837',
    dashId:     'f75-z6m-tar',
    slack:      '#arbys-ops-alerts',
    pagerduty:  'arbys-oncall',
    runbook:    'https://runbooks.inspire-brands.internal/arbys',
    monitorPrefix: "Arby's —",
  },
  {
    key:        'bww',
    name:       'Buffalo Wild Wings',
    team:       'bww-ops',
    color:      '#F5A800',
    dashId:     'q5d-bjs-bse',
    slack:      '#bww-ops-alerts',
    pagerduty:  'bww-oncall',
    runbook:    'https://runbooks.inspire-brands.internal/bww',
    monitorPrefix: 'BWW —',
  },
  {
    key:        'sonic',
    name:       'Sonic Drive-In',
    team:       'sonic-ops',
    color:      '#005FA3',
    dashId:     'nxt-4cb-fca',
    slack:      '#sonic-ops-alerts',
    pagerduty:  'sonic-oncall',
    runbook:    'https://runbooks.inspire-brands.internal/sonic',
    monitorPrefix: 'Sonic —',
  },
  {
    key:        'dunkin',
    name:       "Dunkin'",
    team:       'dunkin-ops',
    color:      '#FF671F',
    dashId:     'yd2-vab-79j',
    slack:      '#dunkin-ops-alerts',
    pagerduty:  'dunkin-oncall',
    runbook:    'https://runbooks.inspire-brands.internal/dunkin',
    monitorPrefix: "Dunkin' —",
  },
  {
    key:        'baskin-robbins',
    name:       'Baskin-Robbins',
    team:       'br-ops',
    color:      '#E8256A',
    dashId:     'mu7-y5j-aw3',
    slack:      '#br-ops-alerts',
    pagerduty:  'baskin-robbins-oncall',
    runbook:    'https://runbooks.inspire-brands.internal/baskin-robbins',
    monitorPrefix: 'Baskin-Robbins —',
  },
  {
    key:        'jimmy-johns',
    name:       "Jimmy John's",
    team:       'jj-ops',
    color:      '#C8102E',
    dashId:     'tap-3s5-x26',
    slack:      '#jj-ops-alerts',
    pagerduty:  'jj-oncall',
    runbook:    'https://runbooks.inspire-brands.internal/jimmy-johns',
    monitorPrefix: "Jimmy John's —",
  },
];

// ── API helpers ───────────────────────────────────────────
function ddRequest(method, path, body, apiVersion = 'v1') {
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

// ── Step 1: Find all Inspire monitors ────────────────────
async function findInspireMonitors() {
  console.log('  Searching monitors tagged service:inspire-brands-platform...');
  const res = await ddRequest('GET', '/api/v1/monitors?query=tag%3Aservice%3Ainspire-brands-platform&per_page=100');
  if (res.status !== 200) {
    console.warn('  ⚠  Could not fetch monitors:', res.status);
    return [];
  }
  const monitors = res.body;
  console.log(`  Found ${monitors.length} monitors`);
  return monitors;
}

// ── Step 2: Update monitor messages with triage info ─────
function buildTriageMessage(brand, monitorType) {
  const typeLabels = {
    errors:   { severity: 'P2', title: 'POS Error Rate Elevated', icon: '🔴', checkFirst: 'Check POS terminal connectivity and payment gateway status.' },
    latency:  { severity: 'P3', title: 'POS Latency Degraded',    icon: '🟡', checkFirst: 'Check for slow-pos feature flag and upstream DB query times.' },
    anomaly:  { severity: 'P3', title: 'Order Volume Anomaly',     icon: '🟠', checkFirst: 'Review marketing events schedule and check for upstream outages.' },
    loyalty:  { severity: 'P2', title: 'Loyalty Service Errors',   icon: '🔴', checkFirst: 'Check loyalty DB connection pool and cache hit rate.' },
    delivery: { severity: 'P3', title: 'Delivery ETA Elevated',    icon: '🟡', checkFirst: 'Contact DoorDash/Uber Eats operations team; check local demand surge.' },
    platform: { severity: 'P1', title: 'Platform Error Rate High', icon: '🚨', checkFirst: 'Immediately check all brand health endpoints and shared infrastructure.' },
  };
  const t = typeLabels[monitorType] || typeLabels.errors;

  return `${t.icon} **${t.title} — ${brand.name}**

**Severity**: ${t.severity} — Customer-Impacting
**Team**: ${brand.team}
**Slack**: ${brand.slack}
**Pagerduty**: @${brand.pagerduty}

**Immediate Triage:**
1. ${t.checkFirst}
2. Open brand dashboard → https://app.${SITE}/dashboard/${brand.dashId}
3. Check recent logs → https://app.${SITE}/logs?query=brand%3A${brand.key}+status%3Aerror
4. Review APM traces → https://app.${SITE}/apm/services/inspire-${brand.key}-pos?env=${ENV_TAG}

**Runbook**: ${brand.runbook}/${monitorType}
**Escalation**: ${brand.slack} → @${brand.pagerduty} → #platform-oncall (P1 only)

{{#is_recovery}}
✅ **Recovered** — ${brand.name} ${t.title} is back to normal. Verify in dashboard.
{{/is_recovery}}`;
}

async function updateMonitorTriageInfo(monitors) {
  let updated = 0;
  for (const brand of BRANDS) {
    for (const monitor of monitors) {
      const name = monitor.name || '';
      if (!name.startsWith(brand.monitorPrefix)) continue;

      let monitorType = 'errors';
      if (name.toLowerCase().includes('latency') || name.toLowerCase().includes('p95')) monitorType = 'latency';
      else if (name.toLowerCase().includes('anomaly') || name.toLowerCase().includes('volume')) monitorType = 'anomaly';
      else if (name.toLowerCase().includes('loyalty')) monitorType = 'loyalty';
      else if (name.toLowerCase().includes('delivery') || name.toLowerCase().includes('eta')) monitorType = 'delivery';
      else if (name.toLowerCase().includes('platform')) monitorType = 'platform';

      const newMessage = buildTriageMessage(brand, monitorType);
      const payload = { ...monitor, message: newMessage };
      // Remove read-only fields
      ['id', 'created', 'creator', 'deleted', 'org_id', 'overall_state', 'overall_state_modified',
       'matching_downtimes', 'modified', 'multi', 'restricted_roles'].forEach(k => delete payload[k]);

      const res = await ddRequest('PUT', `/api/v1/monitor/${monitor.id}`, payload);
      if (res.status === 200) {
        console.log(`  ✓ Updated triage: ${name}`);
        updated++;
      } else {
        console.warn(`  ✗ Failed ${name}: ${res.status}`, JSON.stringify(res.body).slice(0, 120));
      }
      await sleep(200);
    }
  }
  // Handle cross-brand monitors
  for (const monitor of monitors) {
    const name = monitor.name || '';
    if (!name.toLowerCase().includes('platform') && !name.toLowerCase().includes('loyalty') && !name.toLowerCase().includes('delivery')) continue;
    if (BRANDS.some(b => name.startsWith(b.monitorPrefix))) continue; // already handled above

    let monitorType = 'platform';
    if (name.toLowerCase().includes('loyalty')) monitorType = 'loyalty';
    if (name.toLowerCase().includes('delivery')) monitorType = 'delivery';

    const platformBrand = {
      key:       'platform',
      name:      'Inspire Brands Platform',
      team:      'inspire-platform',
      dashId:    '3t7-6rx-4xc',
      slack:     '#platform-oncall',
      pagerduty: 'platform-oncall',
      runbook:   'https://runbooks.inspire-brands.internal/platform',
    };

    const newMessage = buildTriageMessage(platformBrand, monitorType);
    const payload = { ...monitor, message: newMessage };
    ['id', 'created', 'creator', 'deleted', 'org_id', 'overall_state', 'overall_state_modified',
     'matching_downtimes', 'modified', 'multi', 'restricted_roles'].forEach(k => delete payload[k]);

    const res = await ddRequest('PUT', `/api/v1/monitor/${monitor.id}`, payload);
    if (res.status === 200) {
      console.log(`  ✓ Updated triage: ${name}`);
      updated++;
    } else {
      console.warn(`  ✗ Failed ${name}: ${res.status}`);
    }
    await sleep(200);
  }
  console.log(`  ${updated} monitors updated with triage info`);
}

// ── Step 3: Create SLOs ───────────────────────────────────
async function createSLOs(monitors) {
  const sloIds = {};

  for (const brand of BRANDS) {
    // Find the POS error rate monitor for this brand
    const errorMonitor = monitors.find(m =>
      m.name && m.name.startsWith(brand.monitorPrefix) &&
      (m.name.toLowerCase().includes('error') || m.name.toLowerCase().includes('pos error'))
    );
    const latencyMonitor = monitors.find(m =>
      m.name && m.name.startsWith(brand.monitorPrefix) &&
      (m.name.toLowerCase().includes('latency') || m.name.toLowerCase().includes('p95'))
    );

    // Availability SLO (monitor-based on error rate monitor, else metric-based)
    let availSloId = null;
    if (errorMonitor) {
      const payload = {
        type:        'monitor',
        name:        `${brand.name} — POS Availability`,
        description: `POS order success rate >= 99.5% for ${brand.name}. Alerts when error rate monitor fires.`,
        tags:        [`brand:${brand.key}`, `team:${brand.team}`, `env:${ENV_TAG}`, 'service:inspire-brands-platform'],
        thresholds:  [
          { target: 99.5, target_display: '99.5', timeframe: '7d'  },
          { target: 99.0, target_display: '99.0', timeframe: '30d' },
        ],
        monitor_ids: [errorMonitor.id],
      };
      const res = await ddRequest('POST', '/api/v1/slo', payload);
      if (res.status === 200 && res.body.data?.[0]?.id) {
        availSloId = res.body.data[0].id;
        console.log(`  ✓ SLO: ${brand.name} Availability (${availSloId})`);
      } else {
        console.warn(`  ✗ Availability SLO for ${brand.name}: ${res.status}`, JSON.stringify(res.body).slice(0, 200));
      }
    } else {
      // Metric-based fallback
      const payload = {
        type:        'metric',
        name:        `${brand.name} — POS Availability`,
        description: `POS order success rate for ${brand.name}`,
        tags:        [`brand:${brand.key}`, `team:${brand.team}`, `env:${ENV_TAG}`, 'service:inspire-brands-platform'],
        thresholds:  [
          { target: 99.5, target_display: '99.5', timeframe: '7d'  },
          { target: 99.0, target_display: '99.0', timeframe: '30d' },
        ],
        query: {
          numerator:   `sum:inspire.orders.created{brand:${brand.key},env:${ENV_TAG}}.as_count() - sum:inspire.pos.errors{brand:${brand.key},env:${ENV_TAG}}.as_count()`,
          denominator: `sum:inspire.orders.created{brand:${brand.key},env:${ENV_TAG}}.as_count()`,
        },
      };
      const res = await ddRequest('POST', '/api/v1/slo', payload);
      if (res.status === 200 && res.body.data?.[0]?.id) {
        availSloId = res.body.data[0].id;
        console.log(`  ✓ SLO (metric): ${brand.name} Availability (${availSloId})`);
      } else {
        console.warn(`  ✗ Metric SLO for ${brand.name}: ${res.status}`, JSON.stringify(res.body).slice(0, 200));
      }
    }
    if (availSloId) sloIds[brand.key] = availSloId;

    // Latency SLO (monitor-based on p95 monitor)
    if (latencyMonitor) {
      const payload = {
        type:        'monitor',
        name:        `${brand.name} — POS Latency`,
        description: `POS p95 transaction latency <= 500ms for ${brand.name}.`,
        tags:        [`brand:${brand.key}`, `team:${brand.team}`, `env:${ENV_TAG}`, 'service:inspire-brands-platform'],
        thresholds:  [
          { target: 99.0, target_display: '99.0', timeframe: '7d'  },
          { target: 98.0, target_display: '98.0', timeframe: '30d' },
        ],
        monitor_ids: [latencyMonitor.id],
      };
      const res = await ddRequest('POST', '/api/v1/slo', payload);
      if (res.status === 200 && res.body.data?.[0]?.id) {
        const id = res.body.data[0].id;
        sloIds[`${brand.key}_latency`] = id;
        console.log(`  ✓ SLO: ${brand.name} Latency (${id})`);
      } else {
        console.warn(`  ✗ Latency SLO for ${brand.name}: ${res.status}`, JSON.stringify(res.body).slice(0, 200));
      }
    }

    await sleep(300);
  }
  return sloIds;
}

// ── Step 4: Create Global Operations Dashboard ───────────
function sloWidget(sloId, title, x, y) {
  return {
    definition: {
      type:              'slo',
      title,
      title_size:        '13',
      title_align:       'left',
      slo_id:            sloId,
      show_error_budget: true,
      view_type:         'detail',
      time_windows:      ['7d'],
      view_mode:         'overall',
      global_time_target: '0',
    },
    layout: { x, y, width: 2, height: 2 },
  };
}

async function createGlobalDashboard(sloIds) {
  const brandColors = {
    arbys:           '#E31837',
    bww:             '#F5A800',
    sonic:           '#005FA3',
    dunkin:          '#FF671F',
    'baskin-robbins':'#E8256A',
    'jimmy-johns':   '#C8102E',
  };

  const ordersByBrandRequests = BRANDS.map((b, i) => ({
    formulas:   [{ formula: 'orders', alias: b.name }],
    queries:    [{ query: `sum:inspire.orders.created{brand:${b.key}}.as_count()`, data_source: 'metrics', name: 'orders' }],
    response_format: 'timeseries',
    style: { palette: 'classic', line_type: 'solid', line_width: 'normal' },
    display_type: 'bars',
  }));

  const errorByBrandRequests = BRANDS.map(b => ({
    formulas:   [{ formula: 'errors', alias: b.name }],
    queries:    [{ query: `sum:inspire.pos.errors{brand:${b.key}}.as_count()`, data_source: 'metrics', name: 'errors' }],
    response_format: 'timeseries',
    style: { palette: 'warm', line_type: 'solid', line_width: 'normal' },
    display_type: 'line',
  }));

  const latencyByBrandRequests = BRANDS.map(b => ({
    formulas:   [{ formula: 'p95', alias: b.name }],
    queries:    [{ query: `p95:inspire.pos.processing_time{brand:${b.key}}`, data_source: 'metrics', name: 'p95' }],
    response_format: 'timeseries',
    style: { palette: 'cool', line_type: 'solid', line_width: 'normal' },
    display_type: 'line',
  }));

  const dataQualityRequests = BRANDS.map(b => ({
    formulas:   [{ formula: 'q', alias: b.name }],
    queries:    [{ query: `avg:inspire.data.quality_score{brand:${b.key}}`, data_source: 'metrics', name: 'q' }],
    response_format: 'timeseries',
    style: { palette: 'green', line_type: 'solid', line_width: 'normal' },
    display_type: 'line',
  }));

  // Build SLO widgets row (up to 6 brands × 2 = 12, so 2 wide each across 12 cols)
  const sloWidgets = [];
  BRANDS.forEach((b, i) => {
    const id = sloIds[b.key];
    if (id) {
      sloWidgets.push(sloWidget(id, `${b.name} Avail.`, i * 2, 10));
    }
  });

  const widgets = [
    // ── Row 0: Header ──────────────────────────────────────────────────
    {
      definition: {
        type:             'image',
        url:              'https://inspirebrands.com/wp-content/uploads/2019/03/inspire-brands-new-logo.png',
        sizing:           'contain',
        margin:           'md',
        has_background:   false,
        has_border:       false,
        horizontal_align: 'center',
        vertical_align:   'center',
      },
      layout: { x: 0, y: 0, width: 2, height: 2 },
    },
    {
      definition: {
        type:             'note',
        content:          '## 🌐 Inspire Brands — Global Operations Command Center\nReal-time view across all 6 brands · Service: `inspire-brands-platform` · Env: `local`',
        background_color: 'gray',
        font_size:        '14',
        text_align:       'left',
        vertical_align:   'center',
        show_tick:        false,
        tick_pos:         '50%',
        tick_edge:        'left',
        has_padding:      true,
      },
      layout: { x: 2, y: 0, width: 10, height: 2 },
    },

    // ── Row 2: Platform KPIs ───────────────────────────────────────────
    {
      definition: {
        type:        'query_value',
        title:       'Total Orders (1h)',
        title_size:  '16',
        title_align: 'left',
        autoscale:   true,
        precision:   0,
        requests: [{
          formulas: [{ formula: 'a' }],
          queries:  [{ query: `sum:inspire.orders.created{env:${ENV_TAG}}.as_count()`, data_source: 'metrics', name: 'a', aggregator: 'sum' }],
          response_format: 'scalar',
        }],
      },
      layout: { x: 0, y: 2, width: 2, height: 2 },
    },
    {
      definition: {
        type:        'query_value',
        title:       'Total Revenue (1h)',
        title_size:  '16',
        title_align: 'left',
        autoscale:   true,
        precision:   2,
        requests: [{
          formulas: [{ formula: 'a' }],
          queries:  [{ query: `sum:inspire.orders.revenue{env:${ENV_TAG}}.as_count()`, data_source: 'metrics', name: 'a', aggregator: 'sum' }],
          response_format: 'scalar',
        }],
        custom_unit: '$',
      },
      layout: { x: 2, y: 2, width: 2, height: 2 },
    },
    {
      definition: {
        type:        'query_value',
        title:       'POS Errors (1h)',
        title_size:  '16',
        title_align: 'left',
        autoscale:   true,
        precision:   0,
        requests: [{
          formulas: [{ formula: 'a' }],
          queries:  [{ query: `sum:inspire.pos.errors{env:${ENV_TAG}}.as_count()`, data_source: 'metrics', name: 'a', aggregator: 'sum' }],
          response_format: 'scalar',
          conditional_formats: [
            { comparator: '>', value: 50,  palette: 'white_on_red'    },
            { comparator: '>', value: 10,  palette: 'white_on_yellow' },
            { comparator: '<=', value: 10, palette: 'white_on_green'  },
          ],
        }],
      },
      layout: { x: 4, y: 2, width: 2, height: 2 },
    },
    {
      definition: {
        type:        'query_value',
        title:       'P95 POS Latency',
        title_size:  '16',
        title_align: 'left',
        autoscale:   true,
        precision:   0,
        requests: [{
          formulas: [{ formula: 'a' }],
          queries:  [{ query: `avg:inspire.pos.processing_time.95percentile{env:${ENV_TAG}}`, data_source: 'metrics', name: 'a', aggregator: 'avg' }],
          response_format: 'scalar',
          conditional_formats: [
            { comparator: '>', value: 800, palette: 'white_on_red'    },
            { comparator: '>', value: 400, palette: 'white_on_yellow' },
            { comparator: '<=', value: 400, palette: 'white_on_green' },
          ],
        }],
        custom_unit: 'ms',
      },
      layout: { x: 6, y: 2, width: 2, height: 2 },
    },
    {
      definition: {
        type:        'query_value',
        title:       'Avg Data Quality Score',
        title_size:  '16',
        title_align: 'left',
        autoscale:   false,
        precision:   1,
        requests: [{
          formulas: [{ formula: 'a' }],
          queries:  [{ query: `avg:inspire.data.quality_score{env:${ENV_TAG}}`, data_source: 'metrics', name: 'a', aggregator: 'avg' }],
          response_format: 'scalar',
          conditional_formats: [
            { comparator: '<',  value: 80,  palette: 'white_on_red'    },
            { comparator: '<',  value: 90,  palette: 'white_on_yellow' },
            { comparator: '>=', value: 90,  palette: 'white_on_green'  },
          ],
        }],
        custom_unit: '/100',
      },
      layout: { x: 8, y: 2, width: 2, height: 2 },
    },
    {
      definition: {
        type:        'query_value',
        title:       'Platform Queue Depth',
        title_size:  '16',
        title_align: 'left',
        autoscale:   true,
        precision:   0,
        requests: [{
          formulas: [{ formula: 'a' }],
          queries:  [{ query: `sum:inspire.data.pipeline_queue_depth{env:${ENV_TAG}}`, data_source: 'metrics', name: 'a', aggregator: 'sum' }],
          response_format: 'scalar',
          conditional_formats: [
            { comparator: '>',  value: 500, palette: 'white_on_red'    },
            { comparator: '>',  value: 200, palette: 'white_on_yellow' },
            { comparator: '<=', value: 200, palette: 'white_on_green'  },
          ],
        }],
      },
      layout: { x: 10, y: 2, width: 2, height: 2 },
    },

    // ── Row 4-7: Orders + Toplist ──────────────────────────────────────
    {
      definition: {
        type:        'timeseries',
        title:       'Order Volume by Brand',
        title_size:  '16',
        title_align: 'left',
        show_legend: true,
        legend_layout: 'auto',
        requests:    ordersByBrandRequests,
        yaxis:       { include_zero: true },
      },
      layout: { x: 0, y: 4, width: 8, height: 4 },
    },
    {
      definition: {
        type:        'toplist',
        title:       'Top Brands by Order Volume',
        title_size:  '16',
        title_align: 'left',
        requests: [{
          formulas: [{ formula: 'a', limit: { count: 6, order: 'desc' } }],
          queries:  [{ query: `sum:inspire.orders.created{env:${ENV_TAG}} by {brand}.as_count()`, data_source: 'metrics', name: 'a', aggregator: 'sum' }],
          response_format: 'scalar',
        }],
        style: { display: { type: 'stacked', legend: 'automatic' }, scaling: 'relative' },
      },
      layout: { x: 8, y: 4, width: 4, height: 4 },
    },

    // ── Row 8-9: Brand health table ────────────────────────────────────
    {
      definition: {
        type:    'note',
        content: '### Brand SLOs — 7-Day Availability',
        background_color: 'vivid_blue',
        font_size:        '14',
        text_align:       'center',
        vertical_align:   'center',
        show_tick:        false,
        has_padding:      true,
      },
      layout: { x: 0, y: 8, width: 12, height: 1 },
    },

    // SLO widgets are inserted here dynamically (row 9)
    ...sloWidgets.map(w => ({ ...w, layout: { ...w.layout, y: 9 } })),

    // ── Row 11-14: Error rate + Latency timeseries ─────────────────────
    {
      definition: {
        type:        'timeseries',
        title:       'POS Error Rate by Brand',
        title_size:  '16',
        title_align: 'left',
        show_legend: true,
        requests:    errorByBrandRequests,
        markers: [{ value: 'y > 10', display_type: 'error dashed', label: 'Error threshold' }],
      },
      layout: { x: 0, y: 11, width: 6, height: 4 },
    },
    {
      definition: {
        type:        'timeseries',
        title:       'POS p95 Latency by Brand (ms)',
        title_size:  '16',
        title_align: 'left',
        show_legend: true,
        requests:    latencyByBrandRequests,
        markers: [{ value: 'y > 500', display_type: 'warning dashed', label: 'p95 > 500ms' }],
      },
      layout: { x: 6, y: 11, width: 6, height: 4 },
    },

    // ── Row 15-18: Data Observability ──────────────────────────────────
    {
      definition: {
        type:    'note',
        content: '### Data Pipeline Observability',
        background_color: 'vivid_purple',
        font_size:        '14',
        text_align:       'center',
        vertical_align:   'center',
        show_tick:        false,
        has_padding:      true,
      },
      layout: { x: 0, y: 15, width: 12, height: 1 },
    },
    {
      definition: {
        type:        'timeseries',
        title:       'Data Quality Score by Brand (0–100)',
        title_size:  '16',
        title_align: 'left',
        show_legend: true,
        requests:    dataQualityRequests,
        yaxis:       { min: '0', max: '100', include_zero: true },
        markers: [
          { value: 'y < 80', display_type: 'error dashed',   label: 'Critical'  },
          { value: 'y < 90', display_type: 'warning dashed', label: 'Degraded'  },
        ],
      },
      layout: { x: 0, y: 16, width: 6, height: 4 },
    },
    {
      definition: {
        type:        'timeseries',
        title:       'Menu Sync Freshness by Brand (seconds)',
        title_size:  '16',
        title_align: 'left',
        show_legend: true,
        requests: BRANDS.map(b => ({
          formulas:   [{ formula: 'a', alias: b.name }],
          queries:    [{ query: `avg:inspire.data.menu_sync_age_seconds{brand:${b.key}}`, data_source: 'metrics', name: 'a' }],
          response_format: 'timeseries',
          style: { palette: 'warm', line_type: 'solid', line_width: 'normal' },
          display_type: 'line',
        })),
        markers: [{ value: 'y > 240', display_type: 'warning dashed', label: 'Stale (>4 min)' }],
      },
      layout: { x: 6, y: 16, width: 6, height: 4 },
    },
    {
      definition: {
        type:        'timeseries',
        title:       'Order Pipeline Queue Depth by Brand',
        title_size:  '16',
        title_align: 'left',
        show_legend: true,
        requests: BRANDS.map(b => ({
          formulas:   [{ formula: 'a', alias: b.name }],
          queries:    [{ query: `avg:inspire.data.pipeline_queue_depth{brand:${b.key}}`, data_source: 'metrics', name: 'a' }],
          response_format: 'timeseries',
          style: { palette: 'cool', line_type: 'solid', line_width: 'normal' },
          display_type: 'area',
        })),
      },
      layout: { x: 0, y: 20, width: 6, height: 4 },
    },
    {
      definition: {
        type:        'timeseries',
        title:       'Inventory Sync Lag by Brand (ms)',
        title_size:  '16',
        title_align: 'left',
        show_legend: true,
        requests: BRANDS.map(b => ({
          formulas:   [{ formula: 'a', alias: b.name }],
          queries:    [{ query: `avg:inspire.data.inventory_lag_ms{brand:${b.key}}`, data_source: 'metrics', name: 'a' }],
          response_format: 'timeseries',
          style: { palette: 'classic', line_type: 'solid', line_width: 'normal' },
          display_type: 'line',
        })),
        markers: [{ value: 'y > 500', display_type: 'warning dashed', label: '>500ms lag' }],
      },
      layout: { x: 6, y: 20, width: 6, height: 4 },
    },

    // ── Row 24-27: Cost & Datadog Usage ───────────────────────────────
    {
      definition: {
        type:    'note',
        content: '### Platform Cost & Observability Spend',
        background_color: 'vivid_yellow',
        font_size:        '14',
        text_align:       'center',
        vertical_align:   'center',
        show_tick:        false,
        has_padding:      true,
      },
      layout: { x: 0, y: 24, width: 12, height: 1 },
    },
    {
      definition: {
        type:        'timeseries',
        title:       'Datadog Estimated Log Ingestion (bytes)',
        title_size:  '16',
        title_align: 'left',
        show_legend: true,
        requests: [{
          formulas:   [{ formula: 'a', alias: 'Logs Ingested' }],
          queries:    [{ query: 'sum:datadog.estimated_usage.logs.ingested_bytes{*}', data_source: 'metrics', name: 'a' }],
          response_format: 'timeseries',
          style: { palette: 'dog_classic', line_type: 'solid', line_width: 'normal' },
          display_type: 'area',
        }],
      },
      layout: { x: 0, y: 25, width: 4, height: 4 },
    },
    {
      definition: {
        type:        'timeseries',
        title:       'Datadog Estimated Custom Metrics',
        title_size:  '16',
        title_align: 'left',
        show_legend: true,
        requests: [{
          formulas:   [{ formula: 'a', alias: 'Custom Metrics' }],
          queries:    [{ query: 'sum:datadog.estimated_usage.metrics.custom{*}', data_source: 'metrics', name: 'a' }],
          response_format: 'timeseries',
          style: { palette: 'purple', line_type: 'solid', line_width: 'normal' },
          display_type: 'line',
        }],
      },
      layout: { x: 4, y: 25, width: 4, height: 4 },
    },
    {
      definition: {
        type:    'note',
        content: `## 💰 Cost Management\n\nView full cost breakdown, allocation by team, and forecasting in:\n\n**[→ Datadog Cloud Cost Management](https://app.${SITE}/cost/summary)**\n\n**[→ Usage Summary](https://app.${SITE}/account/usage)**\n\nTip: Filter by \`team:\` tag to see per-brand observability spend allocation.`,
        background_color: 'white',
        font_size:        '14',
        text_align:       'left',
        vertical_align:   'top',
        show_tick:        false,
        has_padding:      true,
      },
      layout: { x: 8, y: 25, width: 4, height: 4 },
    },
    {
      definition: {
        type:        'timeseries',
        title:       'Cost Per Order (Infra $ / Order Volume)',
        title_size:  '16',
        title_align: 'left',
        show_legend: true,
        requests: [{
          formulas: [{ formula: 'cost / orders', alias: 'Cost/Order ($)' }],
          queries: [
            { query: `sum:datadog.estimated_usage.logs.ingested_bytes{*}`, data_source: 'metrics', name: 'cost' },
            { query: `sum:inspire.orders.created{env:${ENV_TAG}}.as_count()`, data_source: 'metrics', name: 'orders' },
          ],
          response_format: 'timeseries',
          style: { palette: 'orange', line_type: 'solid', line_width: 'normal' },
          display_type: 'line',
        }],
      },
      layout: { x: 0, y: 29, width: 12, height: 3 },
    },
  ];

  const payload = {
    title:       'Inspire Brands — Global Operations Dashboard',
    description: 'Platform-wide view across all 6 brands: order volume, SLOs, data pipeline health, and cost attribution.',
    layout_type: 'ordered',
    widgets,
    tags:        ['team:inspire-platform'],
  };

  const res = await ddRequest('POST', '/api/v1/dashboard', payload);
  if (res.status === 200 && res.body.id) {
    console.log(`  ✓ Global dashboard created → https://app.${SITE}/dashboard/${res.body.id}`);
    return res.body.id;
  } else {
    console.error(`  ✗ Failed to create global dashboard: ${res.status}`, JSON.stringify(res.body).slice(0, 300));
    return null;
  }
}

// ── Step 5: Update dd-assets.json ────────────────────────
async function updateAssets(globalDashId, sloIds) {
  const assetsPath = path.join(__dirname, 'app', 'public', 'dd-assets.json');
  const assets = JSON.parse(fs.readFileSync(assetsPath, 'utf8'));

  if (globalDashId) {
    assets.dashboards.global = globalDashId;
    assets.urls.globalDashboard = `https://app.${SITE}/dashboard/${globalDashId}`;
  }

  assets.slos = sloIds;
  assets.urls.slos = `https://app.${SITE}/slos`;
  assets.urls.costManagement = `https://app.${SITE}/cost/summary`;
  assets.urls.usageSummary   = `https://app.${SITE}/account/usage`;

  fs.writeFileSync(assetsPath, JSON.stringify(assets, null, 2));
  console.log(`  ✓ dd-assets.json updated`);
}

// ── Main ──────────────────────────────────────────────────
(async () => {
  console.log('🚀 Enhancing Inspire Brands demo...\n');

  console.log('📊 Step 1/5: Finding existing monitors...');
  const monitors = await findInspireMonitors();

  console.log('\n📝 Step 2/5: Updating monitor triage information...');
  if (monitors.length > 0) {
    await updateMonitorTriageInfo(monitors);
  } else {
    console.log('  ↩  No monitors found — skipping triage update');
  }

  console.log('\n🎯 Step 3/5: Creating SLOs...');
  const sloIds = await createSLOs(monitors);
  console.log(`  Created ${Object.keys(sloIds).length} SLOs`);

  console.log('\n🌐 Step 4/5: Creating global operations dashboard...');
  const globalDashId = await createGlobalDashboard(sloIds);

  console.log('\n💾 Step 5/5: Updating dd-assets.json...');
  await updateAssets(globalDashId, sloIds);

  console.log('\n✅ Done! Summary:');
  console.log(`   Monitors updated: ${monitors.length}`);
  console.log(`   SLOs created:     ${Object.keys(sloIds).length}`);
  if (globalDashId) console.log(`   Global dashboard: https://app.${SITE}/dashboard/${globalDashId}`);
  console.log(`   Cost links added: https://app.${SITE}/cost/summary`);
})();
