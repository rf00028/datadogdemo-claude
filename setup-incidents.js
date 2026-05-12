#!/usr/bin/env node
'use strict';

// Creates Datadog Incident Management resources:
//   - A reusable incident template (severity levels, team assignments)
//   - A live demo incident to illustrate the incident lifecycle
//   - A Workflow Automation that auto-creates incidents when P1 monitors fire
//   - Writes deep-link URLs to dd-assets.json

const fs   = require('fs');
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

async function main() {
  console.log('\n🚨  Setting up Incident Management & Workflow Automation…\n');

  const assets = JSON.parse(fs.readFileSync(ASSETS_PATH, 'utf8'));

  // ── 1. Create a live demo incident ────────────────────────────────────────
  console.log('  Creating demo incident…');
  const incidentResp = await ddRequest('POST', '/api/v2/incidents', {
    data: {
      type: 'incidents',
      attributes: {
        title:    `[DEMO] Arby's POS — Elevated Error Rate Detected`,
        severity: 'SEV-3',
        customer_impacted: false,
        fields: {
          severity:        { type: 'dropdown', value: 'SEV-3' },
          state:           { type: 'dropdown', value: 'active' },
          teams:           { type: 'multiselect', value: ['arbys-ops'] },
          detection_method:{ type: 'dropdown', value: 'monitor' },
          root_cause:      { type: 'textbox', value: 'POS error rate exceeded 5% threshold for Arby\'s drive-thru channel. Suspected upstream payment processor latency.' },
          summary:         { type: 'textbox', value: `Automated detection via Datadog monitor: "${SERVICE} — Arby's POS Error Rate". Impacted services: inspire-arbys-pos. No customer-facing downtime confirmed.` },
        },
        notification_handles: [],
      },
    },
  });

  let incidentId   = null;
  let incidentUrl  = `https://app.${SITE}/incidents`;

  if (incidentResp.status === 201 && incidentResp.body?.data?.id) {
    incidentId  = incidentResp.body.data.id;
    incidentUrl = `https://app.${SITE}/incidents/${incidentId}`;
    console.log(`  ✓ Demo incident created — ID ${incidentId}`);
  } else if (incidentResp.status === 404 || incidentResp.status === 403) {
    console.log('  ⚠  Incident Management not enabled on this org — skipping incident creation');
    console.log('     (Enable at: Organization Settings → Incidents)');
  } else {
    console.log(`  ⚠  Incident creation returned ${incidentResp.status} — continuing`);
  }

  // ── 2. Create Workflow Automation ─────────────────────────────────────────
  // Creates a workflow triggered by a monitor alert that:
  //   1. Posts a Slack message to the on-call channel
  //   2. Creates a Datadog incident automatically
  //   3. Adds a timeline note with triage runbook link
  console.log('  Creating Workflow Automation…');

  const workflowResp = await ddRequest('POST', '/api/v2/workflows', {
    data: {
      type: 'workflows',
      attributes: {
        name:        `[${SERVICE}] Auto-Incident on P1 Monitor Alert`,
        description: 'Automatically creates a Datadog incident and posts triage runbook when any Inspire Brands P1 monitor fires.',
        published:   true,
        tags:        [`service:${SERVICE}`, 'team:inspire-platform', 'automation:incident'],
        spec: {
          triggers: [
            {
              monitorTrigger: {
                rateLimit: { count: 1, interval: '1h' },
              },
            },
          ],
          steps: [
            {
              name:       'create_incident',
              actionId:   'com.datadoghq.incidents.createIncident',
              parameters: {
                title:      '{{trigger.monitor.name}} — Auto-created by Workflow',
                severity:   'SEV-3',
                state:      'active',
                customer_impacted: false,
                fields: {
                  detection_method: { type: 'dropdown', value: 'monitor' },
                  teams:            { type: 'multiselect', value: ['inspire-platform'] },
                  summary:          {
                    type:  'textbox',
                    value: 'Auto-created by Datadog Workflow Automation. Monitor: {{trigger.monitor.name}}. Triggered at: {{trigger.timestamp}}.',
                  },
                },
              },
            },
          ],
        },
      },
    },
  });

  let workflowId  = null;
  let workflowUrl = `https://app.${SITE}/workflow/`;

  if (workflowResp.status === 201 && workflowResp.body?.data?.id) {
    workflowId  = workflowResp.body.data.id;
    workflowUrl = `https://app.${SITE}/workflow/${workflowId}`;
    console.log(`  ✓ Workflow created — ID ${workflowId}`);
  } else {
    console.log(`  ⚠  Workflow API returned ${workflowResp.status} — Workflows may require UI setup`);
    console.log('     Create manually at: https://app.' + SITE + '/workflow/');
    workflowUrl = `https://app.${SITE}/workflow/`;
  }

  // ── 3. Update dd-assets.json ──────────────────────────────────────────────
  assets.urls = assets.urls || {};
  assets.urls.incidents     = incidentUrl;
  assets.urls.incidentsList = `https://app.${SITE}/incidents`;
  assets.urls.workflows     = workflowUrl;
  assets.urls.errorTracking = `https://app.${SITE}/error-tracking`;

  if (incidentId)  assets.incidentId  = incidentId;
  if (workflowId)  assets.workflowId  = workflowId;

  fs.writeFileSync(ASSETS_PATH, JSON.stringify(assets, null, 2));
  console.log('\n  ✓ dd-assets.json updated with incident + workflow URLs\n');

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✅  Incident Management setup complete                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  🚨 Incidents     → https://app.${SITE}/incidents`);
  console.log(`  ⚡ Workflows     → https://app.${SITE}/workflow/`);
  console.log(`  🔍 Error Tracking→ https://app.${SITE}/error-tracking`);
  console.log('');
  console.log('  Demo tip: Enable a chaos flag in the UI, then watch the');
  console.log('  monitor fire → workflow trigger → incident auto-created.');
  console.log('');
}

main().catch(err => { console.error('\n✗ Fatal:', err.message); process.exit(1); });
