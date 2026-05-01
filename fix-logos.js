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

function ddRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: `api.${SITE}`, path, method,
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

const FIXES = [
  {
    id:      'mu7-y5j-aw3',
    name:    'Baskin-Robbins',
    logoUrl: 'https://inspirebrands.com/wp-content/uploads/2022/04/IB_BROnlineStamp-01.png',
  },
  {
    id:      '2t6-2kz-we3',
    name:    'Inspire Brands Global',
    logoUrl: 'https://inspirebrands.com/wp-content/uploads/2022/06/Inspire-Brands-Logo-with-Portfolio.png',
  },
];

async function fixLogo({ id, name, logoUrl }) {
  const get = await ddRequest('GET', `/api/v1/dashboard/${id}`);
  if (get.status !== 200) { console.error(`✗ GET ${name}: ${get.status}`); return; }

  const dash = get.body;

  // Replace any image widget at y=0 with the new URL
  const widgets = (dash.widgets || []).map(w => {
    if (w.definition.type === 'image' && w.layout.y === 0) {
      return { ...w, definition: { ...w.definition, url: logoUrl } };
    }
    return w;
  });

  const payload = {
    title: dash.title, layout_type: dash.layout_type, widgets,
    ...(dash.description        ? { description:        dash.description        } : {}),
    ...(dash.template_variables ? { template_variables: dash.template_variables } : {}),
    ...(dash.notify_list        ? { notify_list:        dash.notify_list        } : {}),
    ...(dash.tags               ? { tags:               dash.tags               } : {}),
  };

  const put = await ddRequest('PUT', `/api/v1/dashboard/${id}`, payload);
  if (put.status === 200) {
    console.log(`✓ ${name} logo updated → https://app.${SITE}/dashboard/${id}`);
  } else {
    console.error(`✗ PUT ${name}: ${put.status}`, JSON.stringify(put.body).slice(0, 200));
  }
}

(async () => {
  for (const fix of FIXES) await fixLogo(fix);
  console.log('Done.');
})();
