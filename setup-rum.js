#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const https= require('https');
const path = require('path');

try {
  fs.readFileSync('.env','utf8').split('\n').forEach(line=>{
    const m=line.match(/^([^#=]+)=(.*)$/);
    if(m) process.env[m[1].trim()]=m[2].trim();
  });
} catch{}

const CUSTOMER = require('./app/customer.config');
const API_KEY  = process.env.DD_API_KEY;
const APP_KEY  = process.env.DD_APP_KEY;
const SITE     = process.env.DD_SITE || 'datadoghq.com';
const SERVICE  = CUSTOMER.platform;
const SVC_PFX  = CUSTOMER.servicePrefix;
const ENV_TAG  = process.env.DD_ENV  || 'local';

if (!API_KEY||!APP_KEY){ console.error('DD_API_KEY and DD_APP_KEY required'); process.exit(1); }

const BRANDS = CUSTOMER.brands;

const ASSETS_PATH = path.join(__dirname,'app','public','dd-assets.json');

function ddRequest(method, urlPath, body, hostname) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: hostname || `api.${SITE}`,
      path:     urlPath,
      method,
      headers: {
        'Content-Type':       'application/json',
        'DD-API-KEY':         API_KEY,
        'DD-APPLICATION-KEY': APP_KEY,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let raw='';
      res.on('data',c=>raw+=c);
      res.on('end',()=>{ try{ resolve({status:res.statusCode,body:JSON.parse(raw)}); }catch{ resolve({status:res.statusCode,body:raw}); } });
    });
    req.on('error',reject);
    if(data) req.write(data);
    req.end();
  });
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

// ── Step 1: Create RUM applications ──────────────────────
async function createRumApps() {
  console.log('\n📱 Step 1/4: Creating RUM applications…');
  const rumMap = {};

  const appsToCreate = [
    ...BRANDS.map(b => ({ key: b.key, name: `${CUSTOMER.company} ${b.name} Web`, service: `${SVC_PFX}-${b.key}-web` })),
    { key: 'global', name: `${CUSTOMER.company} Global Portal`, service: `${SVC_PFX}-global-web` },
  ];

  for (const app of appsToCreate) {
    const res = await ddRequest('POST', '/api/v2/rum/applications', {
      data: {
        type: 'rum_application_create',
        attributes: { name: app.name, type: 'browser' },
      },
    });

    if (res.status === 200 || res.status === 201) {
      const attrs = res.body.data?.attributes;
      rumMap[app.key] = {
        applicationId: attrs.application_id,
        clientToken:   attrs.client_token,
        name:          app.name,
        service:       app.service,
      };
      console.log(`  ✓ ${app.name} — appId: ${attrs.application_id}`);
    } else if (res.status === 409) {
      console.log(`  ↩  ${app.name} — already exists`);
    } else {
      console.warn(`  ✗ ${app.name}: ${res.status}`, JSON.stringify(res.body).slice(0,200));
    }
    await sleep(200);
  }
  return rumMap;
}

// ── Step 2: Create synthetics for brand web apps ─────────
async function createBrandSynthetics() {
  console.log('\n🧪 Step 2/4: Creating brand web app synthetics…');
  const synthIds = {};

  const synths = [
    ...BRANDS.map(b => ({
      key:  b.key,
      name: `[${b.name}] Web App — Menu Load & Order Flow`,
      brand: b,
    })),
    { key: 'global', name: `[${CUSTOMER.company}] Global Portal — Brand Grid Load`, brand: null },
  ];

  for (const s of synths) {
    const isGlobal = s.key === 'global';
    const appPath  = isGlobal ? '/inspire' : `/brands/${s.key}`;
    const baseUrl  = `http://host.docker.internal:3000`;

    const payload = {
      name: s.name,
      type: 'api',
      subtype: 'multi',
      status: 'live',
      locations: ['aws:us-east-1'],
      tags: isGlobal
        ? [`service:${SERVICE}`,'env:local',`team:${CUSTOMER.platformTeam}`]
        : [`brand:${s.key}`,`team:${s.brand.team}`,`service:${SERVICE}`,'env:local'],
      message: isGlobal
        ? `🔴 ${CUSTOMER.company} Global Portal is failing! Check the platform at http://localhost:3000/inspire\n\n@platform-oncall`
        : `🔴 **${s.brand?.name}** web app is failing!\n\nCheck brand web app: http://localhost:3000/brands/${s.key}\nBrand dashboard: https://app.datadoghq.com/dashboard\n\n@${s.brand?.team}`,
      config: {
        steps: [
          // Step 1: Load the web app (should always 200)
          {
            name:    isGlobal ? `Load ${CUSTOMER.company} Portal` : `Load ${s.brand?.name} Web App`,
            subtype: 'http',
            request: {
              method: 'GET',
              url:    `${baseUrl}${appPath}`,
              headers: { 'Accept': 'text/html' },
            },
            assertions: [
              { type: 'statusCode', operator: 'is', target: 200 },
              // Response time < 1500ms — usually passes, occasionally tight
              { type: 'responseTime', operator: 'lessThan', target: 1500 },
            ],
            allowFailure: false,
            isCritical:   true,
          },
          // Step 2: Load the menu API
          ...(isGlobal ? [{
            name:    'Load Platform Brand Data',
            subtype: 'http',
            request: {
              method: 'GET',
              url:    `${baseUrl}/api/brands`,
              headers: { 'Accept': 'application/json' },
            },
            assertions: [
              { type: 'statusCode', operator: 'is', target: 200 },
              { type: 'responseTime', operator: 'lessThan', target: 500 },
              { type: 'body', operator: 'contains', target: '"brands"' },
            ],
            allowFailure: false,
            isCritical:   true,
          }] : [
            {
              name:    `${s.brand?.name} Menu API`,
              subtype: 'http',
              request: {
                method: 'GET',
                url:    `${baseUrl}/api/${s.key}/menu`,
                headers: { 'Accept': 'application/json' },
              },
              assertions: [
                { type: 'statusCode', operator: 'is', target: 200 },
                { type: 'responseTime', operator: 'lessThan', target: 400 },
                { type: 'body', operator: 'contains', target: '"items"' },
              ],
              allowFailure: false,
              isCritical:   true,
            },
            // Step 3: Place an order — FAILS when POS outage flag is active
            {
              name:    `${s.brand?.name} POS Order — POST (fails on outage)`,
              subtype: 'http',
              request: {
                method: 'POST',
                url:    `${baseUrl}/api/${s.key}/orders`,
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body:    JSON.stringify({ channel: s.brand?.channels?.[0] || 'in-store', quantity: 1 }),
              },
              assertions: [
                // Asserts 201 — will FAIL when POS outage returns 503
                { type: 'statusCode', operator: 'is', target: 201 },
                // Response time < 500ms — occasionally fails due to natural latency variation (creates intermittent failures)
                { type: 'responseTime', operator: 'lessThan', target: 500 },
              ],
              allowFailure: false,
              isCritical:   true,
            },
          ]),
        ],
      },
      options: {
        tick_every:      300, // every 5 minutes
        min_failure_duration: 0,
        min_location_failed:  1,
        retry: { count: 1, interval: 500 },
        monitor_options: { notify_audit: false, renotify_interval: 360 },
      },
    };

    const res = await ddRequest('POST', '/api/v1/synthetics/tests', payload);
    if (res.status === 200 || res.status === 201) {
      const id = res.body.public_id;
      synthIds[s.key] = id;
      console.log(`  ✓ ${s.name} (${id})`);
    } else if (res.status === 402) {
      console.warn(`  ⚠  Quota reached for API tests — skipping remaining synthetics`);
      break;
    } else {
      console.warn(`  ✗ ${s.name}: ${res.status}`, JSON.stringify(res.body).slice(0,200));
    }
    await sleep(300);
  }
  return synthIds;
}

// ── Step 3: Add RUM widgets to brand dashboards ───────────
async function addRumWidgetsToDashboards(rumMap) {
  console.log('\n📊 Step 3/4: Adding RUM widgets to brand dashboards…');

  const DASH_IDS = {
    arbys:           'f75-z6m-tar',
    bww:             'q5d-bjs-bse',
    sonic:           'nxt-4cb-fca',
    dunkin:          'yd2-vab-79j',
    'baskin-robbins':'mu7-y5j-aw3',
    'jimmy-johns':   'tap-3s5-x26',
  };

  for (const brand of BRANDS) {
    const dashId  = DASH_IDS[brand.key];
    const service = `${SVC_PFX}-${brand.key}-web`;

    // GET dashboard
    const get = await ddRequest('GET', `/api/v1/dashboard/${dashId}`);
    if (get.status !== 200) { console.warn(`  ✗ GET ${brand.name}: ${get.status}`); continue; }
    const dash = get.body;

    // Find max y to append below existing widgets
    let maxY = 0;
    (dash.widgets||[]).forEach(w => { const bottom = (w.layout?.y||0)+(w.layout?.height||2); if(bottom>maxY) maxY=bottom; });

    const rumQuery = (metric, agg='count') => ({
      data_source: 'rum',
      name:        'a',
      search:      { query: `service:${service}` },
      indexes:     ['*'],
      group_by:    [],
      compute:     metric ? { aggregation: agg, metric } : { aggregation: agg },
      storage:     'hot',
    });

    const newWidgets = [
      // RUM section header
      {
        definition: {
          type:'note', content:`### 📱 RUM — ${brand.name} Web App`,
          background_color:'vivid_orange', font_size:'14', text_align:'center',
          vertical_align:'center', show_tick:false, has_padding:true,
        },
        layout:{ x:0, y:maxY, width:12, height:1 },
      },
      // Sessions timeseries
      {
        definition:{
          type:'timeseries', title:'RUM Sessions', title_size:'16', title_align:'left',
          show_legend:false,
          requests:[{
            formulas:[{formula:'a'}],
            queries:[{ ...rumQuery(null,'count'), name:'a' }],
            response_format:'timeseries',
            style:{ palette:'purple', line_type:'solid', line_width:'normal' },
            display_type:'bars',
          }],
        },
        layout:{ x:0, y:maxY+1, width:4, height:3 },
      },
      // RUM errors timeseries
      {
        definition:{
          type:'timeseries', title:'RUM Errors', title_size:'16', title_align:'left',
          show_legend:false,
          requests:[{
            formulas:[{formula:'a'}],
            queries:[{
              data_source:'rum', name:'a',
              search:{ query:`service:${service} @type:error` },
              indexes:['*'], group_by:[], compute:{ aggregation:'count' }, storage:'hot',
            }],
            response_format:'timeseries',
            style:{ palette:'warm', line_type:'solid', line_width:'normal' },
            display_type:'line',
          }],
        },
        layout:{ x:4, y:maxY+1, width:4, height:3 },
      },
      // RUM Loading time
      {
        definition:{
          type:'timeseries', title:'Page Load Time (p75 ms)', title_size:'16', title_align:'left',
          show_legend:false,
          requests:[{
            formulas:[{formula:'a'}],
            queries:[{
              data_source:'rum', name:'a',
              search:{ query:`service:${service} @type:view` },
              indexes:['*'], group_by:[],
              compute:{ aggregation:'pc75', metric:'@view.loading_time' }, storage:'hot',
            }],
            response_format:'timeseries',
            style:{ palette:'cool', line_type:'solid', line_width:'normal' },
            display_type:'line',
          }],
        },
        layout:{ x:8, y:maxY+1, width:4, height:3 },
      },
      // Top actions toplist
      {
        definition:{
          type:'toplist', title:'Top User Actions', title_size:'16', title_align:'left',
          requests:[{
            formulas:[{ formula:'a', limit:{ count:8, order:'desc' } }],
            queries:[{
              data_source:'rum', name:'a',
              search:{ query:`service:${service} @type:action` },
              indexes:['*'],
              group_by:[{ facet:'@action.name', limit:8, sort:{ order:'desc', aggregation:'count' } }],
              compute:{ aggregation:'count' }, storage:'hot',
            }],
            response_format:'scalar',
          }],
          style:{ display:{ type:'stacked', legend:'automatic' }, scaling:'relative' },
        },
        layout:{ x:0, y:maxY+4, width:6, height:3 },
      },
      // Feature flag evaluation
      {
        definition:{
          type:'timeseries', title:'Feature Flag Evaluations', title_size:'16', title_align:'left',
          show_legend:true,
          requests:[{
            formulas:[{formula:'a', alias:'Flag Evaluations'}],
            queries:[{
              data_source:'rum', name:'a',
              search:{ query:`service:${service} @type:feature_flag` },
              indexes:['*'], group_by:[], compute:{ aggregation:'count' }, storage:'hot',
            }],
            response_format:'timeseries',
            style:{ palette:'green', line_type:'solid', line_width:'normal' },
            display_type:'bars',
          }],
        },
        layout:{ x:6, y:maxY+4, width:6, height:3 },
      },
    ];

    // Append new widgets
    const updatedWidgets = [...(dash.widgets||[]), ...newWidgets];
    const payload = {
      title: dash.title, layout_type: dash.layout_type, widgets: updatedWidgets,
      ...(dash.description        ? { description:        dash.description }        : {}),
      ...(dash.template_variables ? { template_variables: dash.template_variables } : {}),
      ...(dash.notify_list        ? { notify_list:        dash.notify_list }        : {}),
      ...(dash.tags               ? { tags:               dash.tags }               : {}),
    };

    const put = await ddRequest('PUT', `/api/v1/dashboard/${dashId}`, payload);
    if (put.status === 200) {
      console.log(`  ✓ RUM widgets added → ${brand.name}`);
    } else {
      console.warn(`  ✗ ${brand.name}: ${put.status}`, JSON.stringify(put.body).slice(0,150));
    }
    await sleep(300);
  }
}

// ── Step 4: Write dd-assets.json ─────────────────────────
async function writeAssets(rumMap, synthIds) {
  console.log('\n💾 Step 4/4: Updating dd-assets.json…');
  const assets = JSON.parse(fs.readFileSync(ASSETS_PATH,'utf8'));

  assets.rum       = rumMap;
  assets.synthRum  = synthIds;

  // Add brand logo URLs for the brand apps — sourced from customer.config
  assets.brandLogoUrls = CUSTOMER.brandLogoUrls || {};

  fs.writeFileSync(ASSETS_PATH, JSON.stringify(assets, null, 2));
  console.log('  ✓ dd-assets.json updated with RUM configs');
}

// ── Main ──────────────────────────────────────────────────
(async () => {
  console.log('🚀 Setting up RUM, Synthetics, and Brand Web Apps…');

  const rumMap   = await createRumApps();
  const synthIds = await createBrandSynthetics();
  await addRumWidgetsToDashboards(rumMap);
  await writeAssets(rumMap, synthIds);

  console.log('\n✅ Done! Summary:');
  console.log(`   RUM apps created:    ${Object.keys(rumMap).length}`);
  console.log(`   Synthetics created:  ${Object.keys(synthIds).length}`);
  console.log('\n   Brand web apps:');
  BRANDS.forEach(b => console.log(`   → http://localhost:3000/brands/${b.key}`));
  console.log('   → http://localhost:3000/inspire  (global portal)');
})();
