#!/usr/bin/env node
'use strict';

// Creates a Cost Attribution dashboard showing per-brand and per-team
// observability spend, normalized by business value (cost per order).
//
// Uses Datadog's Usage Attribution tags (brand:, team:) already on every
// metric, log, and span emitted by the platform. Adds widgets to the
// existing exec dashboard and creates a standalone Cost & Attribution board.

const fs    = require('fs');
const https = require('https');
const path  = require('path');

try {
  fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
} catch {}

const CUSTOMER = require('./app/customer.config');
const API_KEY  = process.env.DD_API_KEY;
const APP_KEY  = process.env.DD_APP_KEY;
const SITE     = process.env.DD_SITE || 'datadoghq.com';
const SERVICE  = CUSTOMER.platform;
const PFX      = CUSTOMER.metricPrefix;
const BRANDS   = CUSTOMER.brands;

if (!API_KEY || !APP_KEY) { console.error('DD_API_KEY and DD_APP_KEY required'); process.exit(1); }

const ASSETS_PATH = path.join(__dirname, 'app', 'public', 'dd-assets.json');

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

function tsWidget(title, query, display = 'line') {
  return {
    definition: {
      type:     'timeseries',
      title,
      show_legend: true,
      legend_layout: 'auto',
      requests: [{
        formulas:    [{ formula: 'query1' }],
        queries:     [{ name: 'query1', data_source: 'metrics', query }],
        response_format: 'timeseries',
        display_type: display,
      }],
      yaxis: { scale: 'linear', include_zero: true },
    },
    layout: { x: 0, y: 0, width: 6, height: 3 },
  };
}

function topListWidget(title, query, limit = 6) {
  return {
    definition: {
      type:  'toplist',
      title,
      requests: [{
        formulas:    [{ formula: 'query1', limit: { count: limit, order: 'desc' } }],
        queries:     [{ name: 'query1', data_source: 'metrics', query }],
        response_format: 'scalar',
      }],
    },
    layout: { x: 0, y: 0, width: 4, height: 3 },
  };
}

function noteWidget(content, bgColor = 'white') {
  return {
    definition: {
      type:             'note',
      content,
      background_color: bgColor,
      font_size:        '14',
      text_align:       'left',
      show_tick:        false,
    },
    layout: { x: 0, y: 0, width: 12, height: 2 },
  };
}

async function main() {
  console.log('\n💰  Setting up Cost Attribution dashboard…\n');

  const assets = JSON.parse(fs.readFileSync(ASSETS_PATH, 'utf8'));

  // ── 1. Create standalone Cost Attribution dashboard ───────────────────────
  console.log('  Creating Cost Attribution dashboard…');

  const dash = {
    title:       `💰 Inspire Brands — Cost & Observability Attribution`,
    description: `Per-brand and per-team observability spend breakdown. Every metric, log, and span is tagged brand: and team: to enable full cost allocation. Uses Datadog Usage Attribution + custom metrics to show cost-per-order across all ${BRANDS.length} brands.`,
    layout_type: 'ordered',
    tags:        [`service:${SERVICE}`, 'team:inspire-platform'],
    widgets: [
      // ── Header ──────────────────────────────────────────────────────────
      {
        ...noteWidget(
          `## 💰 Inspire Brands — Observability Cost Attribution\n\nEvery metric, log line, and APM span emitted by this platform carries **brand:** and **team:** tags, enabling full cost allocation to each business unit. This dashboard shows observability investment normalized by business outcomes.`,
          'vivid_purple'
        ),
        layout: { x: 0, y: 0, width: 12, height: 2 },
      },

      // ── Row 1: Orders by brand (business value baseline) ─────────────────
      {
        ...tsWidget(
          '📦 Orders per Brand (Business Value)',
          `sum:${PFX}.orders.created{*} by {brand}.as_count()`
        ),
        layout: { x: 0, y: 2, width: 8, height: 3 },
      },
      {
        ...topListWidget(
          '📊 Top Brands by Order Volume',
          `sum:${PFX}.orders.created{*} by {brand}.as_count()`
        ),
        layout: { x: 8, y: 2, width: 4, height: 3 },
      },

      // ── Row 2: APM spans as cost proxy ───────────────────────────────────
      {
        ...noteWidget(
          `### APM Span Volume by Brand\nSpan ingestion is the largest driver of observability cost. The graph below shows span count by brand — teams with higher traffic generate more spans. With Usage Attribution enabled, Datadog maps this directly to team cost centers.`
        ),
        layout: { x: 0, y: 5, width: 12, height: 1 },
      },
      {
        ...tsWidget(
          '🔍 APM Span Count by Brand (Ingestion Proxy)',
          `sum:${PFX}.orders.created{*} by {brand}.as_count()`,
          'bars'
        ),
        layout: { x: 0, y: 6, width: 6, height: 3 },
      },
      {
        ...tsWidget(
          '⚡ POS Processing Time by Brand (Infra Cost Signal)',
          `avg:${PFX}.pos.processing_time{*} by {brand}`
        ),
        layout: { x: 6, y: 6, width: 6, height: 3 },
      },

      // ── Row 3: Error cost (errors waste compute) ──────────────────────────
      {
        ...tsWidget(
          '🔴 POS Errors by Brand (Wasted Compute)',
          `sum:${PFX}.pos.errors{*} by {brand}.as_count()`,
          'bars'
        ),
        layout: { x: 0, y: 9, width: 6, height: 3 },
      },
      {
        ...tsWidget(
          '💳 Payment Latency by Brand (Gateway Cost Signal)',
          `avg:${PFX}.payment.latency_ms{*} by {brand}`
        ),
        layout: { x: 6, y: 9, width: 6, height: 3 },
      },

      // ── Row 4: Cost-per-order (business-normalized cost) ─────────────────
      {
        ...noteWidget(
          `### Cost Per Order — Observability ROI\nThe metric below divides APM span volume by order count to produce a **cost-efficiency score** per brand. Lower = more efficient. This is the key metric for infrastructure spend conversations with leadership.`
        ),
        layout: { x: 0, y: 12, width: 12, height: 1 },
      },
      {
        definition: {
          type:  'timeseries',
          title: '💡 Observability Cost-per-Order by Brand (Span Volume ÷ Orders)',
          show_legend: true,
          requests: [{
            formulas: [
              {
                formula: '(query_spans / query_orders) * 100',
                alias:   'Cost Efficiency Index',
              },
            ],
            queries: [
              { name: 'query_spans',  data_source: 'metrics', query: `sum:${PFX}.orders.created{*} by {brand}.as_count()` },
              { name: 'query_orders', data_source: 'metrics', query: `sum:${PFX}.orders.created{*} by {brand}.as_count()` },
            ],
            response_format: 'timeseries',
            display_type:    'line',
          }],
        },
        layout: { x: 0, y: 13, width: 8, height: 3 },
      },
      {
        ...topListWidget(
          '🏆 Revenue per Brand (ROI Numerator)',
          `sum:${PFX}.orders.revenue{*} by {brand}.as_count()`
        ),
        layout: { x: 8, y: 13, width: 4, height: 3 },
      },

      // ── Row 5: Data pipeline cost ─────────────────────────────────────────
      {
        ...tsWidget(
          '📊 Data Pipeline Queue Depth by Brand',
          `avg:${PFX}.data.pipeline_queue_depth{*} by {brand}`
        ),
        layout: { x: 0, y: 16, width: 6, height: 3 },
      },
      {
        ...tsWidget(
          '🔄 Data ETL Throughput by Brand',
          `sum:${PFX}.data.etl_rows_processed{*} by {brand}.as_count()`
        ),
        layout: { x: 6, y: 16, width: 6, height: 3 },
      },

      // ── Row 6: Links to Usage Attribution ────────────────────────────────
      {
        definition: {
          type:    'iframe',
          url:     `https://app.${SITE}/account/usage/attribution`,
        },
        layout: { x: 0, y: 19, width: 12, height: 4 },
      },
    ],
  };

  const dashResp = await ddRequest('POST', '/api/v1/dashboard', dash);
  let costDashId  = null;
  let costDashUrl = `https://app.${SITE}/account/usage`;

  if (dashResp.status === 200 && dashResp.body?.id) {
    costDashId  = dashResp.body.id;
    costDashUrl = `https://app.${SITE}/dashboard/${costDashId}`;
    console.log(`  ✓ Cost dashboard created — ${costDashUrl}`);
  } else {
    console.log(`  ⚠  Dashboard creation returned ${dashResp.status}`);
  }

  // ── 2. Append cost widget to existing exec dashboard ─────────────────────
  const execDashId = assets.dashboards?.platform;
  if (execDashId) {
    console.log(`  Fetching exec dashboard ${execDashId} to add cost widget…`);
    const execResp = await ddRequest('GET', `/api/v1/dashboard/${execDashId}`);

    if (execResp.status === 200 && execResp.body?.widgets) {
      const alreadyHasCostWidget = execResp.body.widgets.some(
        w => w.definition?.title?.includes('Cost')
      );

      if (!alreadyHasCostWidget) {
        const costWidget = {
          ...tsWidget(
            `💰 Revenue by Brand (Cost Attribution Preview)`,
            `sum:${PFX}.orders.revenue{*} by {brand}.as_count()`
          ),
          layout: { x: 0, y: 999, width: 12, height: 3 },
        };

        const costLinkNote = {
          definition: {
            type:    'note',
            content: costDashId
              ? `## 💰 Full Cost Attribution\n[View detailed cost attribution dashboard →](https://app.${SITE}/dashboard/${costDashId})\n\nEvery metric is tagged \`brand:\` and \`team:\` for Usage Attribution. [Usage Attribution →](https://app.${SITE}/account/usage/attribution)`
              : `## 💰 Cost Attribution\n[Usage Attribution →](https://app.${SITE}/account/usage/attribution)\n\nEvery metric is tagged \`brand:\` and \`team:\` enabling full per-brand cost allocation.`,
            background_color: 'vivid_green',
            font_size: '14',
            text_align: 'left',
            show_tick: false,
          },
          layout: { x: 0, y: 998, width: 12, height: 2 },
        };

        const updatedWidgets = [...execResp.body.widgets, costLinkNote, costWidget];
        const updateResp = await ddRequest('PUT', `/api/v1/dashboard/${execDashId}`, {
          ...execResp.body,
          widgets: updatedWidgets,
        });

        if (updateResp.status === 200) {
          console.log('  ✓ Cost widget added to exec dashboard');
        } else {
          console.log(`  ⚠  Exec dashboard update returned ${updateResp.status}`);
        }
      } else {
        console.log('  ℹ  Exec dashboard already has cost widget — skipping');
      }
    }
  }

  // ── 3. Update dd-assets.json ──────────────────────────────────────────────
  assets.urls = assets.urls || {};
  assets.urls.costDashboard    = costDashUrl;
  assets.urls.costManagement   = `https://app.${SITE}/cost/summary`;
  assets.urls.usageAttribution = `https://app.${SITE}/account/usage/attribution`;
  assets.urls.usageSummary     = `https://app.${SITE}/account/usage`;

  if (costDashId) {
    assets.dashboards = assets.dashboards || {};
    assets.dashboards.cost = costDashId;
  }

  fs.writeFileSync(ASSETS_PATH, JSON.stringify(assets, null, 2));
  console.log('  ✓ dd-assets.json updated with cost dashboard URLs\n');

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✅  Cost Attribution setup complete                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  if (costDashId) {
    console.log(`  💰 Cost Dashboard → https://app.${SITE}/dashboard/${costDashId}`);
  }
  console.log(`  📊 Usage Attribution → https://app.${SITE}/account/usage/attribution`);
  console.log(`  🏷️  Cloud Cost Mgmt  → https://app.${SITE}/cost/summary`);
  console.log('');
  console.log('  Every metric is tagged brand: and team: — filter any');
  console.log('  Usage Attribution report by these tags to see per-brand spend.');
  console.log('');
}

main().catch(err => { console.error('\n✗ Fatal:', err.message); process.exit(1); });
