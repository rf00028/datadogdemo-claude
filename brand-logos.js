#!/usr/bin/env node
'use strict';

const fs    = require('fs');
const https = require('https');
// Parse .env manually (no dotenv dependency needed)
try {
  fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
} catch {}

const API_KEY = process.env.DD_API_KEY;
const APP_KEY = process.env.DD_APP_KEY;
const SITE    = process.env.DD_SITE || 'datadoghq.com';

if (!API_KEY || !APP_KEY) {
  console.error('DD_API_KEY and DD_APP_KEY are required');
  process.exit(1);
}

const BRANDS = [
  {
    key:     'arbys',
    id:      'f75-z6m-tar',
    name:    "Arby's",
    logoUrl: 'https://inspirebrands.com/wp-content/uploads/2017/10/Arbys.jpg',
  },
  {
    key:     'bww',
    id:      'q5d-bjs-bse',
    name:    'Buffalo Wild Wings',
    logoUrl: 'https://inspirebrands.com/wp-content/uploads/2018/08/Buffalo-Wild-Wings-Logo-Horizontal.jpg',
  },
  {
    key:     'sonic',
    id:      'nxt-4cb-fca',
    name:    'Sonic Drive-In',
    logoUrl: 'https://inspirebrands.com/wp-content/uploads/2020/02/Sonic_Logo-1-scaled.jpg',
  },
  {
    key:     'dunkin',
    id:      'yd2-vab-79j',
    name:    "Dunkin'",
    logoUrl: 'https://inspirebrands.com/wp-content/uploads/2021/06/Dunkin_Donuts_logo.png',
  },
  {
    key:     'baskin-robbins',
    id:      'mu7-y5j-aw3',
    name:    'Baskin-Robbins',
    logoUrl: 'https://inspirebrands.com/wp-content/uploads/2020/11/BR_Logo_TM.png',
  },
  {
    key:     'jimmy-johns',
    id:      'tap-3s5-x26',
    name:    "Jimmy John's",
    logoUrl: 'https://inspirebrands.com/wp-content/uploads/2023/10/JJ-Red-2.png',
  },
];

function ddRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: `api.${SITE}`,
      path,
      method,
      headers: {
        'Content-Type':      'application/json',
        'DD-API-KEY':        API_KEY,
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

function makeBrandLogoWidget(logoUrl) {
  return {
    definition: {
      type:              'image',
      url:               logoUrl,
      sizing:            'contain',
      margin:            'md',
      has_background:    false,
      has_border:        false,
      horizontal_align:  'center',
      vertical_align:    'center',
    },
    layout: { x: 0, y: 0, width: 4, height: 2 },
  };
}

// Shift all existing widgets down by `rows` to make room at top
function shiftWidgetsDown(widgets, rows) {
  return widgets.map(w => ({
    ...w,
    layout: { ...w.layout, y: w.layout.y + rows },
  }));
}

async function brandDashboard(brand) {
  console.log(`\n📊 Processing ${brand.name} (${brand.id})...`);

  // GET current dashboard
  const get = await ddRequest('GET', `/api/v1/dashboard/${brand.id}`);
  if (get.status !== 200) {
    console.error(`  ✗ GET failed: ${get.status}`, get.body);
    return;
  }

  const dash = get.body;

  // Remove any previous image widget we may have added (any image at y=0)
  const filtered = (dash.widgets || []).filter(
    w => !(w.definition.type === 'image' && w.layout.y === 0)
  );

  // Shift existing widgets down 2 rows
  const shifted = shiftWidgetsDown(filtered, 2);

  // Prepend the logo widget
  const newWidgets = [makeBrandLogoWidget(brand.logoUrl), ...shifted];

  // PUT updated dashboard (only send fields the API accepts)
  const payload = {
    title:            dash.title,
    layout_type:      dash.layout_type,
    widgets:          newWidgets,
    ...(dash.description   ? { description:   dash.description }   : {}),
    ...(dash.template_variables ? { template_variables: dash.template_variables } : {}),
    ...(dash.notify_list   ? { notify_list:   dash.notify_list }   : {}),
    ...(dash.tags          ? { tags:          dash.tags }          : {}),
  };

  const put = await ddRequest('PUT', `/api/v1/dashboard/${brand.id}`, payload);
  if (put.status === 200) {
    console.log(`  ✓ Logo added → https://app.${SITE}/dashboard/${brand.id}`);
  } else {
    console.error(`  ✗ PUT failed: ${put.status}`, JSON.stringify(put.body).slice(0, 300));
  }
}

(async () => {
  console.log('🎨 Adding brand logos to Datadog dashboards...');
  for (const brand of BRANDS) {
    await brandDashboard(brand);
  }
  console.log('\n✅ Done!');
})();
