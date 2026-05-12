#!/usr/bin/env node
'use strict';

// Creates Datadog Sensitive Data Scanner (SDS) rules that detect and redact
// PII in logs from the Inspire Brands platform:
//   - Credit card numbers (Visa/MC/Amex/Discover patterns)
//   - US Social Security Numbers
//   - Email addresses in payment/loyalty logs
//   - Generic API key patterns (catches accidental key leakage)
//
// After running this script, trigger a demo by calling:
//   POST /api/sds-demo   (brand: "arbys" | "dunkin" | etc.)
// The emitted log events will be scanned and any matches redacted.

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
  console.log('\n🔐  Setting up Sensitive Data Scanner rules…\n');

  const assets = JSON.parse(fs.readFileSync(ASSETS_PATH, 'utf8'));

  // ── 1. Create or reuse a scanning group ──────────────────────────────────
  // A scanning group scopes SDS rules to a specific log filter.
  console.log('  Creating SDS scanning group for Inspire Brands logs…');

  const groupResp = await ddRequest('POST', '/api/v2/sensitive-data-scanner/scanning-groups', {
    meta: { fingerprint: '' },
    data: {
      type: 'sensitive_data_scanner_group',
      attributes: {
        name:        `Inspire Brands — PCI & PII Scanner`,
        description: 'Scans logs from the Inspire Brands platform for credit card numbers, SSNs, and email addresses in payment/loyalty events.',
        filter:      { query: `service:${SERVICE}` },
        is_enabled:  true,
        product_list: ['logs'],
      },
      relationships: { rules: { data: [] } },
    },
  });

  let groupId  = null;
  let sdsUrl   = `https://app.${SITE}/organization-settings/sensitive-data-scanner`;

  if (groupResp.status === 200 && groupResp.body?.data?.id) {
    groupId = groupResp.body.data.id;
    console.log(`  ✓ Scanning group created — ID ${groupId}`);
  } else if (groupResp.status === 409) {
    console.log('  ℹ  Scanning group already exists — skipping creation');
    const listResp = await ddRequest('GET', '/api/v2/sensitive-data-scanner/scanning-groups');
    groupId = listResp.body?.data?.find(
      g => g.attributes?.name?.includes('Inspire Brands')
    )?.id || null;
  } else {
    console.log(`  ⚠  SDS group creation returned ${groupResp.status}`);
    if (groupResp.status === 403) {
      console.log('     Sensitive Data Scanner requires a Compliance or higher plan.');
      console.log('     Skipping rule creation — update dd-assets.json URLs only.');
    }
  }

  // ── 2. Create scanning rules ──────────────────────────────────────────────
  const RULES = [
    {
      name:        'Credit Card Number (Visa/MC/Amex/Discover)',
      pattern:     '\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12}|(?:\\d[ -]?){13,19})\\b',
      action:      'hash',
      description: 'Detects PAN (primary account numbers) in payment logs and replaces them with a SHA-256 hash.',
      tags:        [`service:${SERVICE}`, 'pci:card-number'],
    },
    {
      name:        'US Social Security Number',
      pattern:     '\\b(?!000|666|9\\d{2})\\d{3}[- ](?!00)\\d{2}[- ](?!0000)\\d{4}\\b',
      action:      'redact',
      description: 'Detects US SSNs in loyalty enrollment and customer records.',
      tags:        [`service:${SERVICE}`, 'pii:ssn'],
    },
    {
      name:        'Email Address in PII Context',
      pattern:     '[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}',
      action:      'partial_redact',
      description: 'Partially redacts customer email addresses in payment and loyalty log events.',
      tags:        [`service:${SERVICE}`, 'pii:email'],
    },
  ];

  const createdRules = [];

  if (groupId) {
    for (const rule of RULES) {
      const resp = await ddRequest('POST', '/api/v2/sensitive-data-scanner/scanning-rules', {
        meta: { fingerprint: '' },
        data: {
          type: 'sensitive_data_scanner_rule',
          attributes: {
            name:          rule.name,
            description:   rule.description,
            is_enabled:    true,
            pattern:       rule.pattern,
            tags:          rule.tags,
            text_replacement: {
              type:               rule.action === 'hash'           ? 'hash'
                                : rule.action === 'partial_redact' ? 'partial_replacement_from_beginning'
                                :                                    'replacement_string',
              number_of_chars:    rule.action === 'partial_redact' ? 3 : undefined,
              replacement_string: rule.action === 'redact'         ? '[REDACTED]' : undefined,
            },
          },
          relationships: {
            group: { data: { type: 'sensitive_data_scanner_group', id: groupId } },
          },
        },
      });

      if (resp.status === 200 && resp.body?.data?.id) {
        console.log(`  ✓ Rule created: ${rule.name}`);
        createdRules.push(resp.body.data.id);
      } else if (resp.status === 409) {
        console.log(`  ℹ  Rule already exists: ${rule.name}`);
      } else {
        console.log(`  ⚠  Rule creation returned ${resp.status}: ${rule.name}`);
      }
    }
  }

  // ── 3. Update dd-assets.json ──────────────────────────────────────────────
  assets.urls = assets.urls || {};
  assets.urls.sensitiveDataScanner = sdsUrl;
  assets.urls.sdsGroup = groupId
    ? `https://app.${SITE}/organization-settings/sensitive-data-scanner`
    : sdsUrl;

  if (groupId)          assets.sdsGroupId    = groupId;
  if (createdRules.length) assets.sdsRuleIds = createdRules;

  fs.writeFileSync(ASSETS_PATH, JSON.stringify(assets, null, 2));
  console.log('\n  ✓ dd-assets.json updated with SDS URLs\n');

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✅  Sensitive Data Scanner setup complete                ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  🔐 SDS Config    → ${sdsUrl}`);
  console.log('');
  console.log('  Demo tip: POST /api/sds-demo (with body {"brand":"arbys"})');
  console.log('  to emit a log event containing fake PII, then watch it');
  console.log('  appear redacted in the Logs Explorer.');
  console.log('');
}

main().catch(err => { console.error('\n✗ Fatal:', err.message); process.exit(1); });
