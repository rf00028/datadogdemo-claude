#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// cleanup-synthetics.js — Datadog Synthetic Test Cleanup
//
// What this script does:
//   1. Loads .env for DD_API_KEY, DD_APP_KEY, DD_SITE
//   2. Loads app/customer.config.js to get the SERVICE name
//   3. Fetches ALL synthetic tests via GET /api/v1/synthetics/tests?page_size=200
//   4. Lists found tests grouped by name
//   5. Deletes DUPLICATE tests — when multiple tests share the same name,
//      keeps the one with the highest uptime_pct (ties broken by oldest created_at)
//   6. Deletes any tests whose name starts with "[dd-demo-app]" (legacy prefix)
//   7. Batch-deletes via DELETE /api/v1/synthetics/tests { "public_ids": [...] }
//   8. Prints a summary: how many deleted, how many kept
//
// Requirements: DD_API_KEY + DD_APP_KEY in .env
// Run: node cleanup-synthetics.js
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

const CUSTOMER = require('./app/customer.config');
const API_KEY  = process.env.DD_API_KEY;
const APP_KEY  = process.env.DD_APP_KEY;
const SITE     = process.env.DD_SITE || 'datadoghq.com';
const SERVICE  = CUSTOMER.platform;

// ── Validation ───────────────────────────────────────────────────────────────
if (!API_KEY || API_KEY === 'your_api_key_here') {
  console.error('\n✗  DD_API_KEY missing or unset in .env\n');
  process.exit(1);
}
if (!APP_KEY || APP_KEY === 'your_app_key_here') {
  console.error('\n✗  DD_APP_KEY missing or unset in .env');
  console.error(`   Get it at: https://app.${SITE}/organization-settings/application-keys\n`);
  process.exit(1);
}

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

// ── Helpers ──────────────────────────────────────────────────────────────────

// Pick the "winner" from a group of tests with the same name.
// Prefer highest uptime_pct; break ties by oldest created_at (keep the original).
function pickWinner(tests) {
  return tests.reduce((best, t) => {
    const bestUptime = best.overall_state_stats?.uptime?.overall ?? -1;
    const tUptime    = t.overall_state_stats?.uptime?.overall    ?? -1;
    if (tUptime > bestUptime) return t;
    if (tUptime < bestUptime) return best;
    // Tied uptime — prefer older (smaller created_at epoch)
    const bestTs = best.created_at ? new Date(best.created_at).getTime() : Infinity;
    const tTs    = t.created_at    ? new Date(t.created_at).getTime()    : Infinity;
    return tTs < bestTs ? t : best;
  });
}

function pad(str, len) {
  return String(str).padEnd(len);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  🧹  Synthetic Test Cleanup — ${SERVICE.padEnd(27)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  Site:    https://app.${SITE}`);
  console.log(`  Service: ${SERVICE}\n`);

  // ── 1. Fetch all synthetic tests ──────────────────────────────────────────
  console.log('─── Fetching synthetic tests ────────────────────────────────\n');
  const res = await ddRequest('GET', '/api/v1/synthetics/tests?page_size=200', null);

  if (res.status !== 200) {
    console.error(`✗  API returned HTTP ${res.status}:`);
    console.error(JSON.stringify(res.data, null, 2).substring(0, 600));
    process.exit(1);
  }

  const tests = res.data.tests || [];
  console.log(`  Found ${tests.length} synthetic test(s) total.\n`);

  if (tests.length === 0) {
    console.log('  Nothing to do. Exiting.\n');
    return;
  }

  // ── 2. List tests grouped by name ─────────────────────────────────────────
  console.log('─── Tests grouped by name ───────────────────────────────────\n');

  const byName = new Map();
  for (const t of tests) {
    const name = t.name || '(unnamed)';
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(t);
  }

  const sortedNames = [...byName.keys()].sort();
  for (const name of sortedNames) {
    const group = byName.get(name);
    const dup   = group.length > 1 ? ` ← ${group.length} duplicates` : '';
    console.log(`  ${name}${dup}`);
    for (const t of group) {
      const uptime  = t.overall_state_stats?.uptime?.overall ?? 'n/a';
      const created = t.created_at ? t.created_at.substring(0, 10) : 'unknown';
      console.log(`      ${pad(t.public_id, 22)} uptime=${pad(uptime, 8)} created=${created}`);
    }
  }
  console.log('');

  // ── 3. Determine what to delete ───────────────────────────────────────────
  const toDelete   = new Set(); // public_ids to remove
  const deleteWhy  = new Map(); // public_id → reason string (for preview)

  // 3a. Duplicates — keep the winner, delete the rest
  for (const [name, group] of byName.entries()) {
    if (group.length < 2) continue;
    const winner = pickWinner(group);
    for (const t of group) {
      if (t.public_id !== winner.public_id) {
        toDelete.add(t.public_id);
        deleteWhy.set(t.public_id, `duplicate of "${name}" (keeping ${winner.public_id})`);
      }
    }
  }

  // 3b. Legacy [dd-demo-app] prefix — delete regardless of duplicates
  for (const t of tests) {
    if (t.name && t.name.startsWith('[dd-demo-app]')) {
      toDelete.add(t.public_id);
      deleteWhy.set(t.public_id, `legacy [dd-demo-app] prefix`);
    }
  }

  // ── 4. Dry-run preview ────────────────────────────────────────────────────
  const keepCount   = tests.length - toDelete.size;
  const deleteCount = toDelete.size;

  console.log('─── Dry-run preview ─────────────────────────────────────────\n');

  if (deleteCount === 0) {
    console.log('  Nothing to delete — all tests are unique and no legacy prefixes found.\n');
    console.log(`  Kept: ${keepCount}  |  Deleted: 0\n`);
    return;
  }

  console.log(`  Will DELETE ${deleteCount} test(s):\n`);
  for (const id of [...toDelete].sort()) {
    console.log(`    ${pad(id, 22)} — ${deleteWhy.get(id)}`);
  }
  console.log('');
  console.log(`  Will KEEP   ${keepCount} test(s):\n`);
  for (const t of tests) {
    if (!toDelete.has(t.public_id)) {
      const uptime  = t.overall_state_stats?.uptime?.overall ?? 'n/a';
      console.log(`    ${pad(t.public_id, 22)} — "${t.name}"  (uptime: ${uptime})`);
    }
  }
  console.log('');

  // ── 5. Execute batch delete ───────────────────────────────────────────────
  console.log('─── Deleting ────────────────────────────────────────────────\n');

  const ids = [...toDelete];
  process.stdout.write(`  Sending DELETE for ${ids.length} test(s)... `);

  const delRes = await ddRequest('POST', '/api/v1/synthetics/tests/delete', { public_ids: ids });

  if (delRes.status >= 200 && delRes.status < 300) {
    console.log('OK\n');
  } else {
    console.log(`\n✗  HTTP ${delRes.status}:`);
    console.log(JSON.stringify(delRes.data, null, 2).substring(0, 600));
    process.exit(1);
  }

  // ── 6. Summary ────────────────────────────────────────────────────────────
  console.log('─── Summary ─────────────────────────────────────────────────\n');
  console.log(`  Total fetched : ${tests.length}`);
  console.log(`  Deleted       : ${deleteCount}`);
  console.log(`  Kept          : ${keepCount}`);
  console.log('');
  console.log(`  Synthetics → https://app.${SITE}/synthetics/list\n`);
}

main().catch(err => { console.error('\n✗ Fatal:', err.message); process.exit(1); });
