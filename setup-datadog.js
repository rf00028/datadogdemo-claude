#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// setup-datadog.js — Inspire Brands × Datadog Demo Setup
//
// Creates:
//   • 6 Teams           (one per brand: arbys-ops, bww-ops, sonic-ops, etc.)
//   • 18 Monitors       (3 per brand: POS errors, POS latency, anomaly detection)
//   •  3 Cross-brand    (platform-wide error rate, loyalty health, delivery SLO)
//   •  7 Synthetics     (health check + one per brand POS endpoint)
//   •  1 Exec Dashboard (all-brands overview)
//   •  6 Brand Dashboards
//
// Requirements: DD_API_KEY + DD_APP_KEY in .env
// Run: node setup-datadog.js
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

const API_KEY  = process.env.DD_API_KEY;
const APP_KEY  = process.env.DD_APP_KEY;
const SITE     = process.env.DD_SITE || 'datadoghq.com';
const SERVICE  = 'inspire-brands-platform';
const ENV_TAG  = process.env.DD_ENV || 'local';
const NOTIFY   = '';  // e.g. '@ricky.fair@datadoghq.com'

if (!API_KEY || API_KEY === 'your_api_key_here') {
  console.error('\n✗  DD_API_KEY missing in .env\n'); process.exit(1);
}
if (!APP_KEY || APP_KEY === 'your_app_key_here') {
  console.error('\n✗  DD_APP_KEY missing in .env');
  console.error(`   Get it at: https://app.${SITE}/organization-settings/application-keys\n`);
  process.exit(1);
}

// ── Brand definitions ────────────────────────────────────────────────────────
const BRANDS = [
  { key: 'arbys',           name: "Arby's",            team: 'arbys-ops', color: '#E31837' },
  { key: 'bww',             name: 'Buffalo Wild Wings', team: 'bww-ops',   color: '#F5A800' },
  { key: 'sonic',           name: 'Sonic Drive-In',     team: 'sonic-ops', color: '#005FA3' },
  { key: 'dunkin',          name: "Dunkin'",             team: 'dunkin-ops',color: '#FF671F' },
  { key: 'baskin-robbins',  name: 'Baskin-Robbins',      team: 'br-ops',    color: '#E8256A' },
  { key: 'jimmy-johns',     name: "Jimmy John's",        team: 'jj-ops',    color: '#C8102E' },
];

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

const created = { teams: [], monitors: [], synthetics: [], dashboards: [] };

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

// ── Private locations for synthetics ────────────────────────────────────────
async function getPrivateLocations() {
  const res = await ddRequest('GET', '/api/v1/synthetics/locations', null);
  if (res.status !== 200) return [];
  return (res.data.locations || []).filter(l => l.id.startsWith('private:'));
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  🍔  Inspire Brands × Datadog — Demo Setup               ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  Site:    https://app.${SITE}`);
  console.log(`  Service: ${SERVICE}  •  Env: ${ENV_TAG}`);
  console.log(`  Brands:  ${BRANDS.map(b => b.key).join(', ')}\n`);

  // ── TEAMS ──────────────────────────────────────────────────────────────────
  console.log('─── Teams ──────────────────────────────────────────────────\n');

  // Platform team
  await create(
    '🏢 Platform Engineering Team',
    'POST', '/api/v2/teams',
    {
      data: {
        type: 'teams',
        attributes: {
          name:        'Inspire Platform Engineering',
          handle:      'inspire-platform',
          description: 'Owns the inspire-brands-platform service and cross-brand infrastructure',
        },
      },
    },
    created.teams
  );

  // One team per brand
  for (const brand of BRANDS) {
    await create(
      `${brand.name} Ops Team`,
      'POST', '/api/v2/teams',
      {
        data: {
          type: 'teams',
          attributes: {
            name:        `${brand.name} Operations`,
            handle:      brand.team,
            description: `Owns ${brand.name} POS, loyalty, delivery, and inventory services. Brand tag: brand:${brand.key}`,
          },
        },
      },
      created.teams
    );
  }

  // ── MONITORS ──────────────────────────────────────────────────────────────
  console.log('\n─── Per-Brand Monitors ─────────────────────────────────────\n');

  for (const brand of BRANDS) {
    const tag    = `brand:${brand.key}`;
    const team   = `team:${brand.team}`;
    const prefix = `[${brand.name}]`;

    // 1 — POS error rate
    await create(
      `🔴 ${brand.name}: POS Error Rate`,
      'POST', '/api/v1/monitor',
      {
        name:    `${prefix} POS Error Rate — > 5 errors in 5m`,
        type:    'query alert',
        query:   `sum(last_5m):sum:inspire.pos.errors{${tag}}.as_count() > 5`,
        message: `🔴 **${brand.name}** POS is logging {{value}} errors in 5 minutes.\n\nThis may indicate a POS outage or payment gateway issue.\n\n[View APM Traces](https://app.${SITE}/apm/traces?query=service:${SERVICE}+brand:${brand.key}+status:error) ${NOTIFY}`,
        tags:    [`service:${SERVICE}`, `env:${ENV_TAG}`, tag, team, 'monitor_type:errors', 'brand_monitor:true'],
        options: {
          thresholds:     { critical: 5, warning: 2 },
          notify_no_data: false,
          include_tags:   true,
          renotify_interval: 30,
        },
      },
      created.monitors
    );

    // 2 — POS p95 latency
    await create(
      `⏱  ${brand.name}: POS p95 Latency`,
      'POST', '/api/v1/monitor',
      {
        name:    `${prefix} POS p95 Latency > 1500ms`,
        type:    'query alert',
        query:   `avg(last_10m):avg:inspire.pos.processing_time.95percentile{${tag}} > 1500`,
        message: `⏱ **${brand.name}** POS p95 latency is **{{value}}ms** (threshold: 1500ms).\n\nThis could indicate a slow database query, payment processor delay, or resource contention.\n\n[View slow traces](https://app.${SITE}/apm/traces?query=service:${SERVICE}+brand:${brand.key}) ${NOTIFY}`,
        tags:    [`service:${SERVICE}`, `env:${ENV_TAG}`, tag, team, 'monitor_type:latency', 'brand_monitor:true'],
        options: {
          thresholds:     { critical: 1500, warning: 800 },
          notify_no_data: false,
          include_tags:   true,
        },
      },
      created.monitors
    );

    // 3 — Order volume anomaly
    await create(
      `🔮 ${brand.name}: Order Volume Anomaly`,
      'POST', '/api/v1/monitor',
      {
        name:    `${prefix} Anomalous Order Volume`,
        type:    'query alert',
        query:   `avg(last_4h):anomalies(sum:inspire.orders.created{${tag}}.as_count(), 'basic', 2) >= 1`,
        message: `🔮 **${brand.name}** order volume is behaving anomalously.\n\nEither a significant drop (possible outage) or spike (possible abuse/bot traffic) has been detected.\n\n[View metrics](https://app.${SITE}/metric/explorer?q=inspire.orders.created{${tag}}) ${NOTIFY}`,
        tags:    [`service:${SERVICE}`, `env:${ENV_TAG}`, tag, team, 'monitor_type:anomaly', 'brand_monitor:true'],
        options: {
          thresholds:     { critical: 1 },
          notify_no_data: false,
          include_tags:   true,
        },
      },
      created.monitors
    );
  }

  // ── CROSS-BRAND MONITORS ───────────────────────────────────────────────────
  console.log('\n─── Cross-Brand Platform Monitors ──────────────────────────\n');

  await create(
    '🌐 Platform: Overall Error Rate',
    'POST', '/api/v1/monitor',
    {
      name:    `[${SERVICE}] Platform-Wide Error Rate — All Brands`,
      type:    'query alert',
      query:   `sum(last_5m):sum:inspire.http.requests{service:${SERVICE},status:500}.as_count() > 20`,
      message: `🚨 **Inspire Brands Platform** is seeing **{{value}} HTTP 500 errors** across all brands in 5 minutes.\n\nThis is a platform-level event — investigate shared infrastructure (loyalty service, delivery gateway, database).\n\n[APM Overview](https://app.${SITE}/apm/services?env=${ENV_TAG}) ${NOTIFY}`,
      tags:    [`service:${SERVICE}`, `env:${ENV_TAG}`, 'team:inspire-platform', 'monitor_type:platform'],
      options: { thresholds: { critical: 20, warning: 10 }, notify_no_data: false, include_tags: true },
    },
    created.monitors
  );

  await create(
    '💛 Loyalty Service: Elevated Errors',
    'POST', '/api/v1/monitor',
    {
      name:    `[${SERVICE}] Loyalty Service — Elevated Error Rate (All Brands)`,
      type:    'query alert',
      query:   `sum(last_5m):sum:inspire.loyalty.errors{service:${SERVICE}}.as_count() > 10`,
      message: `💛 The **Loyalty Service** is failing across brands — **{{value}} lookup failures** in 5m.\n\nThis shared service impacts all 6 brands. Check loyalty DB connection pool and upstream dependencies.\n\n${NOTIFY}`,
      tags:    [`service:${SERVICE}`, `env:${ENV_TAG}`, 'team:inspire-platform', 'monitor_type:loyalty'],
      options: { thresholds: { critical: 10, warning: 5 }, notify_no_data: false, include_tags: true },
    },
    created.monitors
  );

  await create(
    '🚚 Delivery: High ETA (p95 > 60 min)',
    'POST', '/api/v1/monitor',
    {
      name:    `[${SERVICE}] Delivery ETA p95 > 60 minutes`,
      type:    'query alert',
      query:   `avg(last_10m):avg:inspire.delivery.eta.95percentile{service:${SERVICE}} > 60`,
      message: `🚚 Delivery wait times are critically high — p95 ETA is **{{value}} minutes** across all brands.\n\nThis likely indicates a delivery partner surge or service degradation.\n\n${NOTIFY}`,
      tags:    [`service:${SERVICE}`, `env:${ENV_TAG}`, 'team:inspire-platform', 'monitor_type:delivery'],
      options: { thresholds: { critical: 60, warning: 45 }, notify_no_data: false, include_tags: true },
    },
    created.monitors
  );

  // ── SYNTHETICS ────────────────────────────────────────────────────────────
  console.log('\n─── Synthetic Tests ─────────────────────────────────────────\n');

  const privateLocs = await getPrivateLocations();
  const locations   = privateLocs.length ? [privateLocs[0].id] : ['aws:us-east-1'];
  const baseUrl     = 'http://localhost:3000';

  if (privateLocs.length) {
    console.log(`  ℹ  Using private location: ${privateLocs[0].id} (${privateLocs[0].display_name})\n`);
  } else {
    console.log('  ⚠  No private locations found — synthetics target localhost (update URLs for managed locations)\n');
  }

  // Platform health check
  await create(
    '🟢 Platform: Health Check',
    'POST', '/api/v1/synthetics/tests',
    {
      name:    `[${SERVICE}] Platform Health — GET /health`,
      type:    'api',
      subtype: 'http',
      config: {
        request: { method: 'GET', url: `${baseUrl}/health` },
        assertions: [
          { type: 'statusCode',   operator: 'is',       target: 200 },
          { type: 'responseTime', operator: 'lessThan', target: 2000 },
          { type: 'body',         operator: 'contains', target: '"status":"ok"' },
        ],
      },
      locations,
      options: { tick_every: 60, min_failure_duration: 0, min_location_failed: 1 },
      message: `🔴 **${SERVICE}** platform health check failed! ${NOTIFY}`,
      tags:    [`service:${SERVICE}`, `env:${ENV_TAG}`, 'team:inspire-platform', 'synthetic_type:availability'],
      status:  'live',
    },
    created.synthetics
  );

  // Per-brand POS order synthetic
  for (const brand of BRANDS) {
    await create(
      `🛒 ${brand.name}: POS Order Test`,
      'POST', '/api/v1/synthetics/tests',
      {
        name:    `[${brand.name}] POS Order — POST /api/${brand.key}/orders`,
        type:    'api',
        subtype: 'http',
        config: {
          request: {
            method:  'POST',
            url:     `${baseUrl}/api/${brand.key}/orders`,
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ itemId: 1, channel: 'in-store', quantity: 1 }),
          },
          assertions: [
            { type: 'statusCode',   operator: 'is',       target: 201 },
            { type: 'responseTime', operator: 'lessThan', target: 2000 },
            { type: 'body',         operator: 'contains', target: '"status":"confirmed"' },
          ],
        },
        locations,
        options: { tick_every: 300, min_failure_duration: 0, min_location_failed: 1 },
        message: `🔴 **${brand.name}** POS order synthetic failing! Check brand:${brand.key} in Datadog. ${NOTIFY}`,
        tags:    [`service:${SERVICE}`, `env:${ENV_TAG}`, `brand:${brand.key}`, `team:${brand.team}`, 'synthetic_type:business'],
        status:  'live',
      },
      created.synthetics
    );
  }

  // ── EXECUTIVE OVERVIEW DASHBOARD ──────────────────────────────────────────
  console.log('\n─── Dashboards ──────────────────────────────────────────────\n');

  const brandColors = Object.fromEntries(BRANDS.map(b => [b.key, b.color]));

  await create(
    '📊 Inspire Brands — Executive Overview',
    'POST', '/api/v1/dashboard',
    {
      title:       '🍔 Inspire Brands — Digital Platform Overview',
      description: 'Cross-brand observability: orders, POS health, loyalty, delivery, and alerts across all 6 Inspire brands',
      layout_type: 'ordered',
      tags:        ['team:inspire-platform'],
      widgets: [

        // ── Row 1: Platform KPIs ──────────────────────────────────────────────
        {
          definition: {
            type: 'query_value', title: 'Total Orders (1h)',
            requests: [{ q: `sum:inspire.orders.created{service:${SERVICE}}.as_count()`, aggregator: 'sum' }],
            time: { live_span: '1h' }, precision: 0,
          },
          layout: { x: 0, y: 0, width: 2, height: 2 },
        },
        {
          definition: {
            type: 'query_value', title: 'POS Errors (15m)',
            requests: [{ q: `sum:inspire.pos.errors{service:${SERVICE}}.as_count()`, aggregator: 'sum' }],
            time: { live_span: '15m' }, precision: 0,
            custom_links: [{ label: 'View error traces', link: `https://app.${SITE}/apm/traces?query=service:${SERVICE}+status:error` }],
          },
          layout: { x: 2, y: 0, width: 2, height: 2 },
        },
        {
          definition: {
            type: 'query_value', title: 'Loyalty Errors (15m)',
            requests: [{ q: `sum:inspire.loyalty.errors{service:${SERVICE}}.as_count()`, aggregator: 'sum' }],
            time: { live_span: '15m' }, precision: 0,
          },
          layout: { x: 4, y: 0, width: 2, height: 2 },
        },
        {
          definition: {
            type: 'query_value', title: 'POS p95 Latency (avg)',
            requests: [{ q: `avg:inspire.pos.processing_time.95percentile{service:${SERVICE}}`, aggregator: 'avg' }],
            time: { live_span: '15m' }, precision: 0, custom_unit: 'ms',
          },
          layout: { x: 6, y: 0, width: 2, height: 2 },
        },
        {
          definition: {
            type: 'query_value', title: 'Delivery ETA p95 (avg)',
            requests: [{ q: `avg:inspire.delivery.eta.95percentile{service:${SERVICE}}`, aggregator: 'avg' }],
            time: { live_span: '15m' }, precision: 0, custom_unit: 'min',
          },
          layout: { x: 8, y: 0, width: 2, height: 2 },
        },
        {
          definition: {
            type: 'query_value', title: 'Loyalty Lookups (1h)',
            requests: [{ q: `sum:inspire.loyalty.lookup_latency.count{service:${SERVICE}}.as_count()`, aggregator: 'sum' }],
            time: { live_span: '1h' }, precision: 0,
          },
          layout: { x: 10, y: 0, width: 2, height: 2 },
        },

        // ── Row 2: Orders by brand (timeseries) ───────────────────────────────
        {
          definition: {
            type:  'timeseries',
            title: 'Order Volume by Brand',
            requests: BRANDS.map(b => ({
              q:            `sum:inspire.orders.created{brand:${b.key}}.as_count()`,
              display_type: 'bars',
              style:        { line_type: 'solid', line_width: 'normal' },
              metadata:     [{ expression: `sum:inspire.orders.created{brand:${b.key}}.as_count()`, alias_name: b.name }],
            })),
            yaxis: { include_zero: true },
            time:  { live_span: '1h' },
          },
          layout: { x: 0, y: 2, width: 6, height: 3 },
        },

        // ── Row 2: POS errors by brand ────────────────────────────────────────
        {
          definition: {
            type:  'timeseries',
            title: 'POS Errors by Brand',
            requests: BRANDS.map(b => ({
              q:            `sum:inspire.pos.errors{brand:${b.key}}.as_count()`,
              display_type: 'bars',
              metadata:     [{ expression: `sum:inspire.pos.errors{brand:${b.key}}.as_count()`, alias_name: b.name }],
            })),
            yaxis: { include_zero: true },
            time:  { live_span: '1h' },
          },
          layout: { x: 6, y: 2, width: 6, height: 3 },
        },

        // ── Row 3: Per-brand health query values ──────────────────────────────
        ...BRANDS.map((b, i) => ({
          definition: {
            type:  'query_value',
            title: `${b.name} — Orders (1h)`,
            requests: [{
              q:          `sum:inspire.orders.created{brand:${b.key}}.as_count()`,
              aggregator: 'sum',
            }],
            time:      { live_span: '1h' },
            precision: 0,
            custom_links: [{ label: `${b.name} traces`, link: `https://app.${SITE}/apm/traces?query=service:${SERVICE}+brand:${b.key}` }],
          },
          layout: { x: i * 2, y: 5, width: 2, height: 2 },
        })),

        // ── Row 4: POS latency p95 by brand ──────────────────────────────────
        {
          definition: {
            type:  'timeseries',
            title: 'POS Processing Time p95 by Brand',
            requests: BRANDS.map(b => ({
              q:            `avg:inspire.pos.processing_time.95percentile{brand:${b.key}}`,
              display_type: 'line',
              metadata:     [{ expression: `avg:inspire.pos.processing_time.95percentile{brand:${b.key}}`, alias_name: b.name }],
            })),
            yaxis:  { include_zero: true, label: 'ms' },
            time:   { live_span: '1h' },
            markers: [{ value: 'y = 1500', display_type: 'error dashed', label: 'SLO threshold' }],
          },
          layout: { x: 0, y: 7, width: 6, height: 3 },
        },

        // ── Row 4: Loyalty latency by brand ──────────────────────────────────
        {
          definition: {
            type:  'timeseries',
            title: 'Loyalty Lookup Latency p95 by Brand',
            requests: BRANDS.map(b => ({
              q:            `avg:inspire.loyalty.lookup_latency.95percentile{brand:${b.key}}`,
              display_type: 'line',
              metadata:     [{ expression: `avg:inspire.loyalty.lookup_latency.95percentile{brand:${b.key}}`, alias_name: b.name }],
            })),
            yaxis: { include_zero: true, label: 'ms' },
            time:  { live_span: '1h' },
          },
          layout: { x: 6, y: 7, width: 6, height: 3 },
        },

        // ── Row 5: Monitor summary ────────────────────────────────────────────
        {
          definition: {
            type:           'manage_status',
            title:          'Monitor Status — All Brands',
            summary_type:   'monitors',
            query:          `service:${SERVICE}`,
            sort:           'status,asc',
            count:          50,
            start:          0,
            display_format: 'countsAndList',
            color_preference: 'text',
            hide_zero_counts: true,
            show_last_triggered: true,
          },
          layout: { x: 0, y: 10, width: 8, height: 4 },
        },

        // ── Row 5: Feature flag evaluations ──────────────────────────────────
        {
          definition: {
            type:  'timeseries',
            title: 'Feature Flag Evaluations (by flag)',
            requests: [{
              q:            `sum:inspire.feature_flag.evaluation{service:${SERVICE}} by {flag_name}.as_count()`,
              display_type: 'bars',
            }],
            time: { live_span: '1h' },
          },
          layout: { x: 8, y: 10, width: 4, height: 4 },
        },

        // ── Row 6: APM service widget ─────────────────────────────────────────
        {
          definition: {
            type:               'trace_service',
            title:              `APM — ${SERVICE}`,
            service:            SERVICE,
            env:                ENV_TAG,
            span_name:          'express.request',
            show_hits:          true,
            show_errors:        true,
            show_latency:       true,
            show_breakdown:     true,
            show_distribution:  true,
            show_resource_list: true,
            size_format:        'large',
            display_format:     'three_column',
            time:               { live_span: '1h' },
          },
          layout: { x: 0, y: 14, width: 12, height: 5 },
        },

        // ── Row 7: Live log stream ────────────────────────────────────────────
        {
          definition: {
            type:    'log_stream',
            title:   'Live Logs — All Brands',
            query:   `service:${SERVICE}`,
            columns: ['brand', 'team', 'status', 'message'],
            indexes: [],
            time:    { live_span: '30m' },
            sort:    { column: 'time', order: 'desc' },
            message_display:     'expanded-md',
            show_date_column:    true,
            show_message_column: true,
          },
          layout: { x: 0, y: 19, width: 12, height: 4 },
        },
      ],
    },
    created.dashboards
  );

  // ── PER-BRAND DASHBOARDS ───────────────────────────────────────────────────
  for (const brand of BRANDS) {
    const tag  = `brand:${brand.key}`;
    const team = `team:${brand.team}`;

    await create(
      `📈 ${brand.name} — Brand Dashboard`,
      'POST', '/api/v1/dashboard',
      {
        title:       `${brand.name} — Operational Dashboard`,
        description: `POS orders, loyalty, delivery, and errors for ${brand.name}. Team: ${brand.team}`,
        layout_type: 'ordered',
        tags:        [team],
        widgets: [

          // KPIs
          {
            definition: { type: 'query_value', title: 'Orders (1h)',
              requests: [{ q: `sum:inspire.orders.created{${tag}}.as_count()`, aggregator: 'sum' }],
              time: { live_span: '1h' }, precision: 0 },
            layout: { x: 0, y: 0, width: 3, height: 2 },
          },
          {
            definition: { type: 'query_value', title: 'POS Errors (15m)',
              requests: [{ q: `sum:inspire.pos.errors{${tag}}.as_count()`, aggregator: 'sum' }],
              time: { live_span: '15m' }, precision: 0 },
            layout: { x: 3, y: 0, width: 3, height: 2 },
          },
          {
            definition: { type: 'query_value', title: 'Loyalty Lookups (1h)',
              requests: [{ q: `sum:inspire.loyalty.lookup_latency.count{${tag}}.as_count()`, aggregator: 'sum' }],
              time: { live_span: '1h' }, precision: 0 },
            layout: { x: 6, y: 0, width: 3, height: 2 },
          },
          {
            definition: { type: 'query_value', title: 'POS p95 Latency',
              requests: [{ q: `avg:inspire.pos.processing_time.95percentile{${tag}}`, aggregator: 'avg' }],
              time: { live_span: '15m' }, precision: 0, custom_unit: 'ms' },
            layout: { x: 9, y: 0, width: 3, height: 2 },
          },

          // Order volume + POS latency
          {
            definition: {
              type: 'timeseries', title: 'Order Volume by Channel',
              requests: [{
                q:            `sum:inspire.orders.created{${tag}} by {channel}.as_count()`,
                display_type: 'bars',
              }],
              yaxis: { include_zero: true },
              time:  { live_span: '1h' },
            },
            layout: { x: 0, y: 2, width: 6, height: 3 },
          },
          {
            definition: {
              type: 'timeseries', title: 'POS Processing Time — p50 vs p95',
              requests: [
                { q: `avg:inspire.pos.processing_time.median{${tag}}`,         display_type: 'line', metadata: [{ expression: `avg:inspire.pos.processing_time.median{${tag}}`,         alias_name: 'p50' }] },
                { q: `avg:inspire.pos.processing_time.95percentile{${tag}}`,   display_type: 'line', metadata: [{ expression: `avg:inspire.pos.processing_time.95percentile{${tag}}`,   alias_name: 'p95' }] },
              ],
              yaxis: { include_zero: true, label: 'ms' },
              time:  { live_span: '1h' },
              markers: [{ value: 'y = 1500', display_type: 'error dashed', label: 'SLO' }],
            },
            layout: { x: 6, y: 2, width: 6, height: 3 },
          },

          // Loyalty + delivery
          {
            definition: {
              type: 'timeseries', title: 'Loyalty Lookup Latency',
              requests: [
                { q: `avg:inspire.loyalty.lookup_latency.95percentile{${tag}}`, display_type: 'line', metadata: [{ expression: `avg:inspire.loyalty.lookup_latency.95percentile{${tag}}`, alias_name: 'p95' }] },
              ],
              yaxis: { include_zero: true, label: 'ms' },
              time:  { live_span: '1h' },
            },
            layout: { x: 0, y: 5, width: 6, height: 3 },
          },
          {
            definition: {
              type: 'timeseries', title: 'Delivery ETA Distribution',
              requests: [{ q: `avg:inspire.delivery.eta.95percentile{${tag}}`, display_type: 'line' }],
              yaxis: { include_zero: true, label: 'min' },
              time:  { live_span: '1h' },
              markers: [{ value: 'y = 45', display_type: 'warning dashed', label: 'Warning' }, { value: 'y = 60', display_type: 'error dashed', label: 'Critical' }],
            },
            layout: { x: 6, y: 5, width: 6, height: 3 },
          },

          // APM
          {
            definition: {
              type: 'trace_service', title: `APM — ${SERVICE} (${brand.name})`,
              service: SERVICE, env: ENV_TAG, span_name: 'express.request',
              show_hits: true, show_errors: true, show_latency: true,
              show_breakdown: true, show_distribution: true, show_resource_list: true,
              size_format: 'large', display_format: 'three_column',
              time: { live_span: '1h' },
            },
            layout: { x: 0, y: 8, width: 12, height: 5 },
          },

          // Brand log stream
          {
            definition: {
              type:    'log_stream',
              title:   `Live Logs — ${brand.name}`,
              query:   `service:${SERVICE} brand:${brand.key}`,
              columns: ['team', 'status', 'message'],
              indexes: [],
              time:    { live_span: '30m' },
              sort:    { column: 'time', order: 'desc' },
              message_display:     'expanded-md',
              show_date_column:    true,
              show_message_column: true,
            },
            layout: { x: 0, y: 13, width: 12, height: 4 },
          },
        ],
      },
      created.dashboards
    );
  }

  // ── SERVICE CATALOG ────────────────────────────────────────────────────────
  console.log('\n─── Service Catalog ─────────────────────────────────────────\n');

  // Store dashboard IDs from the dashboards we just created
  const dashIds = Object.fromEntries(
    created.dashboards.map((d, i) => {
      const id  = String(d.id || '').replace(/.*\//, '');
      const key = i === 0 ? 'platform' : BRANDS[i - 1]?.key;
      return [key, id];
    })
  );

  // Platform service
  await create(
    `🌐 Service Catalog: inspire-brands-platform`,
    'POST', '/api/v2/services/definitions',
    {
      'schema-version': 'v2.2',
      'dd-service':     SERVICE,
      team:             'inspire-platform',
      description:      'Multi-brand digital platform serving POS, loyalty, and delivery for 6 Inspire Brands. Routes requests to brand-specific services.',
      type:             'web',
      tier:             'High',
      languages:        ['JavaScript'],
      tags:             ['team:inspire-platform', 'env:local'],
      links: [
        { name: 'Exec Dashboard', type: 'dashboard', url: `https://app.${SITE}/dashboard/${dashIds.platform || ''}` },
        { name: 'APM Service',    type: 'other',     url: `https://app.${SITE}/apm/services/${SERVICE}?env=${ENV_TAG}` },
      ],
      contacts: [],
    },
    null
  );

  // Per-brand services: POS, Loyalty, Delivery
  const SERVICE_TYPES = [
    {
      suffix:      'pos',
      description: (b) => `${b.name} Point of Sale — processes orders, manages transactions, and handles payment flow across drive-thru, dine-in, and delivery channels.`,
      linkName:    'POS Dashboard',
    },
    {
      suffix:      'loyalty',
      description: (b) => `${b.name} Loyalty Program — member lookups, points balance, tier management (Bronze / Silver / Gold), and reward redemptions.`,
      linkName:    'Brand Dashboard',
    },
    {
      suffix:      'delivery',
      description: (b) => `${b.name} Delivery Service — delivery partner integration, ETA estimation, and order routing for third-party delivery channels.`,
      linkName:    'Brand Dashboard',
    },
  ];

  for (const brand of BRANDS) {
    for (const svc of SERVICE_TYPES) {
      const ddService = `inspire-${brand.key}-${svc.suffix}`;
      const dashId    = dashIds[brand.key] || '';
      await create(
        `📦 ${brand.name}: ${svc.suffix}`,
        'POST', '/api/v2/services/definitions',
        {
          'schema-version': 'v2.2',
          'dd-service':     ddService,
          team:             brand.team,
          description:      svc.description(brand),
          type:             'web',
          tier:             'High',
          languages:        ['JavaScript'],
          tags:             [`team:${brand.team}`, `brand:${brand.key}`, 'env:local'],
          links: [
            { name: svc.linkName, type: 'dashboard', url: `https://app.${SITE}/dashboard/${dashId}` },
            { name: 'APM Traces', type: 'other',     url: `https://app.${SITE}/apm/traces?query=service:${ddService}+env:${ENV_TAG}` },
          ],
          contacts: [],
        },
        null
      );
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✅  Setup complete!                                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`  🏢 Teams         → https://app.${SITE}/organization-settings/teams`);
  console.log(`  📊 Monitors      → https://app.${SITE}/monitors/manage?q=service:${SERVICE}`);
  console.log(`  🧪 Synthetics    → https://app.${SITE}/synthetics/list?query=service:${SERVICE}`);
  console.log(`  📦 Svc Catalog   → https://app.${SITE}/services`);
  console.log('');

  const [execDash, ...brandDashes] = created.dashboards;
  if (execDash) {
    const execId = String(execDash.id || '').replace(/.*\//, '');
    console.log(`  🌐 Exec Dashboard  → https://app.${SITE}/dashboard/${execId}`);
  }
  for (const d of brandDashes) {
    const id    = String(d.id || '').replace(/.*\//, '');
    const label = d.label.replace('📈 ', '').replace(' — Brand Dashboard', '');
    console.log(`  📈 ${label.padEnd(22)} → https://app.${SITE}/dashboard/${id}`);
  }

  console.log('');
  console.log('  Tagging strategy:');
  console.log(`    service:${SERVICE}`);
  console.log('    brand:<key>   (arbys | bww | sonic | dunkin | baskin-robbins | jimmy-johns)');
  console.log('    team:<handle> (arbys-ops | bww-ops | sonic-ops | dunkin-ops | br-ops | jj-ops)');
  console.log('    env:<env>     channel:<channel>   monitor_type:<type>');
  console.log('');

  // ── Write dd-assets.json for the UI quick-links bar ───────────────────────
  const [execD, ...brandDs] = created.dashboards;
  const dashMap = { platform: String(execD?.id || '').replace(/.*\//, '') };
  BRANDS.forEach((b, i) => {
    dashMap[b.key] = String(brandDs[i]?.id || '').replace(/.*\//, '');
  });

  const assets = {
    site:    SITE,
    service: SERVICE,
    env:     ENV_TAG,
    dashboards: dashMap,
    urls: {
      execDashboard:  `https://app.${SITE}/dashboard/${dashMap.platform}`,
      apm:            `https://app.${SITE}/apm/services?env=${ENV_TAG}&search=inspire`,
      apmMap:         `https://app.${SITE}/apm/map?env=${ENV_TAG}`,
      monitors:       `https://app.${SITE}/monitors/manage?q=service%3A${SERVICE}`,
      serviceCatalog: `https://app.${SITE}/services`,
      synthetics:     `https://app.${SITE}/synthetics/list?query=service%3A${SERVICE}`,
      logs:           `https://app.${SITE}/logs?query=service%3A${SERVICE}`,
      teams:          `https://app.${SITE}/organization-settings/teams`,
      llmObs:         `https://app.${SITE}/llm/traces`,
    },
    brandLinks: Object.fromEntries(BRANDS.map(b => [b.key, {
      dashboard:  `https://app.${SITE}/dashboard/${dashMap[b.key]}`,
      apm:        `https://app.${SITE}/apm/services/inspire-${b.key}-pos?env=${ENV_TAG}`,
      monitors:   `https://app.${SITE}/monitors/manage?q=team%3A${b.team}`,
      logs:       `https://app.${SITE}/logs?query=service%3A${SERVICE}+brand%3A${b.key}`,
    }])),
  };

  const assetsPath = path.join(__dirname, 'app', 'public', 'dd-assets.json');
  fs.writeFileSync(assetsPath, JSON.stringify(assets, null, 2));
  console.log(`  📎 dd-assets.json → ${assetsPath}`);
  console.log('');
}

main().catch(err => { console.error('\n✗ Fatal:', err.message); process.exit(1); });
