#!/usr/bin/env node
// setup-llm-experiments.js
// Creates a Datadog LLM Observability Dataset + two Experiments (v1 vs v2)
// Run: node setup-llm-experiments.js

// Load .env manually (dotenv not available outside app/)
const fs = require('fs'), path = require('path');
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

const DD_API_KEY = process.env.DD_API_KEY;
const DD_APP_KEY = process.env.DD_APP_KEY;
const DD_SITE    = process.env.DD_SITE || 'datadoghq.com';
const ML_APP     = 'inspire-brands-assistant';
const BASE       = `https://api.${DD_SITE}`;

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const NC     = '\x1b[0m';

if (!DD_API_KEY || !DD_APP_KEY) {
  console.error(`${RED}✗ DD_API_KEY and DD_APP_KEY must be set in .env${NC}`);
  process.exit(1);
}

const headers = {
  'DD-API-KEY':         DD_API_KEY,
  'DD-APPLICATION-KEY': DD_APP_KEY,
  'Content-Type':       'application/json',
};

async function dd(method, path, body) {
  const res  = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

// ── Realistic Q&A dataset — 30 brand-specific gold examples ──────────────────
const DATASET_RECORDS = [
  // Arby's
  { input: "What's the best sandwich at Arby's?",                        expected_output: "Arby's is best known for the Beef & Cheddar and the Roast Beef Classic. Both feature slow-roasted beef — the Beef & Cheddar adds cheddar sauce and onion bun for $6.99.", brand: 'arbys',        category: 'menu'     },
  { input: "Is Arby's POS system down?",                                 expected_output: "Checking live status: Arby's POS is currently healthy with no active outage flags. Error rate and latency are within normal thresholds.", brand: 'arbys',        category: 'status'   },
  { input: "What monitor fires when Arby's error rate spikes?",          expected_output: "The monitor '[Arby's] POS Error Rate > 5 errors in 5m' (P2) fires and routes to the arbys-ops team Slack channel with an embedded triage runbook.", brand: 'arbys',        category: 'monitors' },
  { input: "Who owns Arby's alerts in Datadog?",                         expected_output: "The arbys-ops team owns all Arby's monitors and services in Datadog. Every alert routes directly to their Slack channel.", brand: 'arbys',        category: 'teams'    },
  // Buffalo Wild Wings
  { input: "What's the p95 latency SLO for Buffalo Wild Wings POS?",    expected_output: "BWW has a P3 monitor that fires when POS p95 latency exceeds 1500ms. The SLO target is 99.5% of requests under that threshold over a 30-day window.", brand: 'bww',          category: 'slo'      },
  { input: "How do wings promotions affect BWW order volume metrics?",   expected_output: "Wing promotions spike order volume metrics visible in the 'Anomalous Order Volume' monitor (anomaly detection). You'll see a surge in inspire.orders.created tagged brand:bww.", brand: 'bww',          category: 'metrics'  },
  { input: "What team handles Buffalo Wild Wings incidents?",            expected_output: "The bww-ops team owns BWW's services and monitors. They receive P1–P3 alerts with runbooks embedded in each notification.", brand: 'bww',          category: 'teams'    },
  { input: "How does delivery work for BWW in the service map?",        expected_output: "BWW has three APM services: inspire-bww-pos, inspire-bww-loyalty, and inspire-bww-delivery. All fan out from the parent inspire-brands-platform service.", brand: 'bww',          category: 'apm'      },
  // Sonic
  { input: "Why is Sonic showing anomalous order volume?",               expected_output: "The Sonic order volume anomaly detector uses machine learning on historical patterns. A spike beyond 3σ from baseline triggers the P3 monitor and alerts sonic-ops.", brand: 'sonic',        category: 'monitors' },
  { input: "What's the Sonic Drive-In service architecture?",            expected_output: "Sonic has 3 APM services: inspire-sonic-pos, inspire-sonic-loyalty, and inspire-sonic-delivery. The drive-in and drive-thru channels are tagged with channel: metadata.", brand: 'sonic',        category: 'apm'      },
  { input: "How does Sonic's happy hour affect real-time metrics?",      expected_output: "Happy hour triggers a 2–3× spike in inspire.orders.created{brand:sonic, channel:drive-in}. The anomaly monitor accommodates recurring patterns — it won't fire during expected peaks.", brand: 'sonic',        category: 'metrics'  },
  // Dunkin'
  { input: "How are Dunkin' morning rush metrics tracked?",              expected_output: "Mobile-order and drive-thru volumes are tagged channel:mobile-order and channel:drive-thru. The platform emits inspire.orders.created per channel — filter by brand:dunkin in Metrics Explorer.", brand: 'dunkin',       category: 'metrics'  },
  { input: "What team owns Dunkin' in Datadog?",                        expected_output: "The dunkin-ops team owns all Dunkin' services and monitors. They own 3 monitors: POS errors, POS p95 latency, and order volume anomaly.", brand: 'dunkin',       category: 'teams'    },
  { input: "Is there a monitor for Dunkin' cold brew inventory lag?",    expected_output: "Data observability metrics include inspire.data.inventory_lag_ms tagged by brand. You can create a metric monitor on brand:dunkin to alert when lag exceeds your threshold.", brand: 'dunkin',       category: 'monitors' },
  { input: "How does mobile ordering integrate with Dunkin' APM?",       expected_output: "Mobile orders flow through inspire-dunkin-pos service, tagged channel:mobile-order. APM traces show the full request path from order intake through loyalty lookup.", brand: 'dunkin',       category: 'apm'      },
  // Baskin-Robbins
  { input: "What's the catering SLO for Baskin-Robbins?",               expected_output: "Baskin-Robbins has a delivery SLO monitoring p95 delivery ETA. The cross-brand 'Delivery ETA p95 > 60 minutes' monitor (P2) covers catering orders tagged brand:baskin-robbins.", brand: 'baskin-robbins', category: 'slo'   },
  { input: "Which service handles Baskin-Robbins online orders?",        expected_output: "inspire-baskin-robbins-pos handles all online orders. It's tracked in the Datadog Service Catalog under the br-ops team with full APM instrumentation.", brand: 'baskin-robbins', category: 'apm'   },
  // Jimmy John's
  { input: "How is 'Freaky Fast' delivery measured in Datadog?",        expected_output: "inspire.delivery.eta_seconds{brand:jimmy-johns} tracks delivery ETAs in real time. The SLO monitors p95 ETA staying below target. When the delivery-surge flag is on, ETAs triple.", brand: 'jimmy-johns',  category: 'metrics'  },
  { input: "What happens when Jimmy John's delivery ETA exceeds SLO?",  expected_output: "The 'Delivery ETA p95 > 60 minutes' monitor fires (P2) and alerts jj-ops. The notification includes a triage runbook with steps to check the inspire-jimmy-johns-delivery service.", brand: 'jimmy-johns',  category: 'monitors' },
  { input: "How are Jimmy John's catering orders tracked?",             expected_output: "Catering orders use the channel:catering tag and flow through inspire-jimmy-johns-pos. They show up in APM with dedicated traces and in logs filtered by brand:jimmy-johns.", brand: 'jimmy-johns',  category: 'apm'      },
  // Platform / cross-brand
  { input: "How does the loyalty shared service affect all brands?",     expected_output: "All 6 brands share loyalty infrastructure. When loyalty-degraded is toggled, all brands see 40% lookup failures simultaneously — demonstrating cascade risk from a single shared service.", brand: 'platform',     category: 'architecture' },
  { input: "What is Unified Service Tagging?",                          expected_output: "Unified Service Tagging adds env:, version:, service:, brand:, and team: tags to every metric, log, and trace. This lets you pivot from a log error to its correlated trace to the owning team in one click.", brand: 'platform',     category: 'tagging'  },
  { input: "Explain the P1–P3 monitor hierarchy.",                      expected_output: "P1 = platform-wide impact (e.g., > 20 HTTP 500s/5min), routes to all teams. P2 = brand or shared-service impact (POS errors, loyalty failures). P3 = performance degradation (latency, anomaly).", brand: 'platform',     category: 'monitors' },
  { input: "Walk me through alert → triage → resolve.",                 expected_output: "1. Monitor fires → Slack alert with runbook link. 2. On-call engineer checks APM Service Map for the affected brand. 3. Feature flag toggled off to restore service. 4. Incident closed in Datadog.", brand: 'platform',     category: 'workflow' },
  { input: "How does APM show parent-child service relationships?",     expected_output: "The APM Service Map shows inspire-brands-platform as the root with 18 child services (3 per brand). Clicking a brand service shows its error rate, p50/p95/p99 latency, and downstream dependencies.", brand: 'platform',     category: 'apm'      },
  { input: "How is cost attribution done across brands?",               expected_output: "Every metric is tagged team:<brand>-ops. In Cloud Cost Management, filter by team tag to see per-brand observability spend. The Cost/Order derived metric shows infra cost normalized by revenue.", brand: 'platform',     category: 'cost'     },
  { input: "How does LLM Observability work in this demo?",             expected_output: "Every /api/chat call creates a real LLMObs span via dd-trace's llmobs.trace(). Input/output messages, token counts, and evaluation scores (relevance, faithfulness, quality) are all submitted to Datadog.", brand: 'platform',     category: 'llmobs'   },
  { input: "What are the synthetic tests in this demo?",                expected_output: "There are 7 synthetic tests: 1 platform health check on GET /health, and 1 POS order test per brand that places a real POST request. During a POS outage, the synthetic immediately starts failing.", brand: 'platform',     category: 'synthetics' },
  { input: "How does log injection correlate logs with traces?",        expected_output: "dd-trace injects trace_id and span_id into every log line. In Datadog Log Management, click 'View in APM' on any log entry to jump directly to its correlated trace.", brand: 'platform',     category: 'logs'     },
  { input: "Show me all active incidents right now.",                   expected_output: "Checking live platform status across all 6 brands. Each brand's POS, loyalty, and delivery services are monitored in real time — use the demo panel to trigger an outage and watch the monitors fire.", brand: 'platform',     category: 'status'   },
];

async function getProjectId() {
  // Try to list LLM Observability projects
  const r = await dd('GET', '/api/v2/llm-obs/v1/projects');
  if (r.ok && r.data?.data?.length > 0) {
    const proj = r.data.data.find(p => p.attributes?.name === ML_APP) || r.data.data[0];
    return proj.id;
  }
  // Some orgs auto-create a default project — try to fetch by ml_app name
  const r2 = await dd('GET', `/api/v2/llm-obs/v1/projects?filter[name]=${encodeURIComponent(ML_APP)}`);
  if (r2.ok && r2.data?.data?.length > 0) return r2.data.data[0].id;
  return null;
}

async function createDataset(projectId, name, description) {
  const body = { data: { type: 'datasets', attributes: { name, description, metadata: { ml_app: ML_APP, source: 'inspire-brands-demo' } } } };
  const path = projectId ? `/api/v2/llm-obs/v1/${projectId}/datasets` : '/api/v2/llm-obs/v1/datasets';
  return dd('POST', path, body);
}

async function addRecords(projectId, datasetId, records) {
  const path = projectId
    ? `/api/v2/llm-obs/v1/${projectId}/datasets/${datasetId}/records`
    : `/api/v2/llm-obs/v1/datasets/${datasetId}/records`;
  const body = {
    data: {
      type: 'records',
      attributes: {
        records: records.map((r, i) => ({
          id:              `inspire-${r.brand}-${r.category}-${i}`,
          input:           r.input,
          expected_output: r.expected_output,
          metadata:        { brand: r.brand, category: r.category, ml_app: ML_APP },
        })),
      },
    },
  };
  return dd('POST', path, body);
}

async function createExperiment(projectId, datasetId, name, description) {
  const body = {
    data: {
      type: 'experiments',
      attributes: {
        name,
        description,
        dataset_id: datasetId,
        ...(projectId ? { project_id: projectId } : {}),
        metadata: { ml_app: ML_APP, source: 'inspire-brands-demo' },
      },
    },
  };
  return dd('POST', '/api/v2/llm-obs/v1/experiments', body);
}

async function main() {
  console.log('\n🔬 Inspire Brands — LLM Observability Setup\n');

  // ── Step 1: Get project ID ────────────────────────────────────────────────
  console.log('1️⃣  Looking up LLM Observability project...');
  const projectId = await getProjectId();
  if (projectId) {
    console.log(`   ${GREEN}✓ Project ID: ${projectId}${NC}`);
  } else {
    console.log(`   ${YELLOW}⚠  No project found — will try without project_id${NC}`);
  }

  // ── Step 2: Create dataset ────────────────────────────────────────────────
  console.log('\n2️⃣  Creating golden dataset...');
  const dsRes = await createDataset(
    projectId,
    'Inspire Brands Assistant — Golden Q&A',
    '30 brand-specific Q&A pairs covering menu, APM, monitors, SLOs, tagging, and incidents across all 6 Inspire Brands.'
  );

  if (!dsRes.ok) {
    console.log(`   ${RED}✗ Dataset creation failed (${dsRes.status}):${NC}`, JSON.stringify(dsRes.data).slice(0, 300));
    console.log(`\n   ${YELLOW}→ Create the dataset manually in Datadog LLM Observability UI:${NC}`);
    console.log(`     LLM Observability → Datasets → New Dataset`);
    console.log(`     Name: "Inspire Brands Assistant — Golden Q&A"`);
    return;
  }

  const datasetId = dsRes.data?.data?.id;
  console.log(`   ${GREEN}✓ Dataset created: ${datasetId}${NC}`);
  console.log(`   Name: ${dsRes.data?.data?.attributes?.name}`);

  // ── Step 3: Add records ───────────────────────────────────────────────────
  console.log(`\n3️⃣  Adding ${DATASET_RECORDS.length} golden records...`);
  const recRes = await addRecords(projectId, datasetId, DATASET_RECORDS);
  if (recRes.ok) {
    const count = recRes.data?.data?.attributes?.records?.length || DATASET_RECORDS.length;
    console.log(`   ${GREEN}✓ ${count} records added${NC}`);
  } else {
    console.log(`   ${YELLOW}⚠  Records endpoint (${recRes.status}):${NC}`, JSON.stringify(recRes.data).slice(0, 200));
  }

  // ── Step 4: Create experiments ────────────────────────────────────────────
  console.log('\n4️⃣  Creating experiments...');

  const expV1 = await createExperiment(
    projectId, datasetId,
    'v1 vs v2 — Response Quality Comparison',
    'Compares inspire-brands-assistant-v1 and v2 on the golden Q&A dataset. Evaluates relevance, faithfulness, and quality scores.'
  );

  if (expV1.ok) {
    const expId = expV1.data?.data?.id;
    console.log(`   ${GREEN}✓ Experiment created: ${expId}${NC}`);
    console.log(`   Name: ${expV1.data?.data?.attributes?.name}`);
  } else {
    console.log(`   ${YELLOW}⚠  Experiment API (${expV1.status}):${NC}`, JSON.stringify(expV1.data).slice(0, 200));
  }

  const expBrand = await createExperiment(
    projectId, datasetId,
    'Brand Coverage — Cross-Brand Accuracy',
    'Validates assistant accuracy across all 6 brands. Segments performance by brand tag and question category.'
  );

  if (expBrand.ok) {
    console.log(`   ${GREEN}✓ Experiment created: ${expBrand.data?.data?.id}${NC}`);
    console.log(`   Name: ${expBrand.data?.data?.attributes?.name}`);
  } else {
    console.log(`   ${YELLOW}⚠  Experiment 2 (${expBrand.status}):${NC}`, JSON.stringify(expBrand.data).slice(0, 200));
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${GREEN}✓ Done!${NC}`);
  console.log(`\n  📊 View in Datadog:`);
  console.log(`     LLM Observability → Datasets`);
  console.log(`     LLM Observability → Experiment`);
  console.log(`     https://app.datadoghq.com/llm/experiments\n`);
}

main().catch(e => { console.error(RED + '✗ Fatal:', e.message, NC); process.exit(1); });
