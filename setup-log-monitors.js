#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// setup-log-monitors.js — Create log-based monitors for the platform
//
// Creates:
//   • 1 platform-wide log error spike (any brand, > 20 errors in 5m)
//   • 6 per-brand log error monitors (> 5 errors in 5m per brand)
//   • 1 POS order failure log monitor (order failed events)
//   • 1 payment decline log monitor
//   • 1 LLM chat error monitor
//
// Run: node setup-log-monitors.js
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
} catch {}

const CUSTOMER = require('./app/customer.config');
const API_KEY  = process.env.DD_API_KEY;
const APP_KEY  = process.env.DD_APP_KEY;
const SITE     = process.env.DD_SITE || 'datadoghq.com';
const SERVICE  = CUSTOMER.platform;
const METRIC   = CUSTOMER.metricPrefix;
const ENV_TAG  = process.env.DD_ENV || 'local';
const BRANDS   = CUSTOMER.brands;

if (!API_KEY || !APP_KEY) { console.error('DD_API_KEY and DD_APP_KEY required'); process.exit(1); }

function ddRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: `api.${SITE}`,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': API_KEY,
        'DD-APPLICATION-KEY': APP_KEY,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function createMonitor(label, body) {
  process.stdout.write(`  ${label}… `);
  const res = await ddRequest('POST', '/api/v1/monitor', body);
  if (res.status === 200 || res.status === 201) {
    console.log(`✅  (id: ${res.body.id})`);
    return res.body;
  }
  if (JSON.stringify(res.body).toLowerCase().includes('already exists')) {
    console.log(`↩   already exists`);
    return null;
  }
  console.warn(`✗  HTTP ${res.status}`, JSON.stringify(res.body).slice(0, 200));
  return null;
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log(`║  📋  ${CUSTOMER.company} — Log-Based Monitors                 ║`);
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  const baseTags = [`service:${SERVICE}`, `env:${ENV_TAG}`, 'monitor_type:log_alert'];

  // ── Platform-wide error spike ────────────────────────────────────────────
  console.log('─── Platform-wide ──────────────────────────────────────\n');

  await createMonitor('[Platform] Log Error Spike — All Brands', {
    name:    `[${SERVICE}] Log Error Spike — All Brands`,
    type:    'log alert',
    query:   `logs("service:${SERVICE} status:error env:${ENV_TAG}").rollup("count").last("5m") > 20`,
    message: `🚨 **Platform-wide log error spike** — more than 20 errors logged in the last 5 minutes across all brands.\n\nCheck logs: https://app.${SITE}/logs?query=service%3A${SERVICE}+status%3Aerror\n\n@${CUSTOMER.platformTeam}`,
    tags:    [...baseTags, `team:${CUSTOMER.platformTeam}`],
    options: {
      thresholds:         { critical: 20, warning: 10 },
      notify_audit:       false,
      renotify_interval:  30,
      include_tags:       true,
      enable_logs_sample: true,
    },
  });
  await sleep(300);

  // ── POS order failure monitor ────────────────────────────────────────────
  await createMonitor('[Platform] POS Order Failures in Logs', {
    name:    `[${SERVICE}] POS Order Failures — Log Pattern`,
    type:    'log alert',
    query:   `logs("service:${SERVICE} @message:pos.order_failed env:${ENV_TAG}").rollup("count").last("5m") > 5`,
    message: `⚠️ **POS order failures** detected in logs — more than 5 failures in 5 minutes.\n\nCheck logs: https://app.${SITE}/logs?query=service%3A${SERVICE}+%40message%3Apos.order_failed\n\n@${CUSTOMER.platformTeam}`,
    tags:    [...baseTags, `team:${CUSTOMER.platformTeam}`],
    options: {
      thresholds:         { critical: 5, warning: 2 },
      notify_audit:       false,
      renotify_interval:  30,
      include_tags:       true,
      enable_logs_sample: true,
    },
  });
  await sleep(300);

  // ── Payment decline log monitor ──────────────────────────────────────────
  await createMonitor('[Platform] Payment Declines in Logs', {
    name:    `[${SERVICE}] Payment Declines — Log Pattern`,
    type:    'log alert',
    query:   `logs("service:${SERVICE} @payment.status:declined env:${ENV_TAG}").rollup("count").last("5m") > 10`,
    message: `💳 **High payment decline rate** detected in logs — more than 10 declines in 5 minutes. May indicate payment processor issues.\n\nCheck logs: https://app.${SITE}/logs?query=service%3A${SERVICE}+%40payment.status%3Adeclined\n\n@${CUSTOMER.platformTeam}`,
    tags:    [...baseTags, `team:${CUSTOMER.platformTeam}`],
    options: {
      thresholds:         { critical: 10, warning: 5 },
      notify_audit:       false,
      renotify_interval:  30,
      include_tags:       true,
      enable_logs_sample: true,
    },
  });
  await sleep(300);

  // ── LLM chat error monitor ───────────────────────────────────────────────
  await createMonitor('[Platform] LLM Chat Errors in Logs', {
    name:    `[${SERVICE}] LLM Chat Errors — Log Pattern`,
    type:    'log alert',
    query:   `logs("service:${SERVICE} @message:llm.chat_error env:${ENV_TAG}").rollup("count").last("5m") > 3`,
    message: `🤖 **LLM chat errors** detected — the AI assistant is failing for users.\n\nCheck LLM Obs: https://app.${SITE}/llm/traces\nCheck logs: https://app.${SITE}/logs?query=service%3A${SERVICE}+%40message%3Allm.chat_error\n\n@${CUSTOMER.platformTeam}`,
    tags:    [...baseTags, `team:${CUSTOMER.platformTeam}`],
    options: {
      thresholds:         { critical: 3, warning: 1 },
      notify_audit:       false,
      renotify_interval:  30,
      include_tags:       true,
      enable_logs_sample: true,
    },
  });
  await sleep(300);

  // ── Per-brand error monitors ─────────────────────────────────────────────
  console.log('\n─── Per-brand log error monitors ───────────────────────\n');

  for (const brand of BRANDS) {
    await createMonitor(`[${brand.name}] Log Errors`, {
      name:    `[${brand.name}] Log Error Rate — Elevated`,
      type:    'log alert',
      query:   `logs("service:${SERVICE} brand:${brand.key} status:error env:${ENV_TAG}").rollup("count").last("5m") > 5`,
      message: `🔴 **${brand.name}** is logging elevated errors — more than 5 errors in 5 minutes.\n\nCheck logs: https://app.${SITE}/logs?query=service%3A${SERVICE}+brand%3A${brand.key}+status%3Aerror\n\n@${brand.team}`,
      tags:    [...baseTags, `brand:${brand.key}`, `team:${brand.team}`],
      options: {
        thresholds:         { critical: 5, warning: 2 },
        notify_audit:       false,
        renotify_interval:  30,
        include_tags:       true,
        enable_logs_sample: true,
      },
    });
    await sleep(300);
  }

  console.log(`\n  Done. View monitors: https://app.${SITE}/monitors/manage?q=monitor_type%3Alog_alert\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
