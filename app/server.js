const CUSTOMER = require('./customer.config');

// dd-trace MUST be initialized before any other requires
const tracer = require('dd-trace').init({
  service: CUSTOMER.platform,
  env: process.env.DD_ENV || 'local',
  version: process.env.DD_VERSION || '1.0.0',
  logInjection: true,
  runtimeMetrics: true,
  profiling: false,
});

const ddTrace = require('dd-trace');
const LLMObs  = ddTrace.LLMObs;

const express        = require('express');
const path           = require('path');
const winston        = require('winston');
const DatadogWinston = require('datadog-winston');
const StatsD         = require('hot-shots');
const { v4: uuidv4 } = require('uuid');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
let   Anthropic     = null;

// Enable LLMObs — guard in case dd-trace version doesn't export it
if (LLMObs && typeof LLMObs.enable === 'function') {
  LLMObs.enable({ mlApp: CUSTOMER.mlApp, agentlessEnabled: false });
}

if (ANTHROPIC_KEY) {
  Anthropic = require('@anthropic-ai/sdk');
}

// ── Logger ────────────────────────────────────────────────
const DD_BASE_TAGS = `env:${process.env.DD_ENV || 'local'},version:${process.env.DD_VERSION || '1.0.0'}`;

// Custom format: promotes brand/team fields to ddtags so they're searchable as both
// log attributes (@brand:x) AND Datadog tags (brand:x)
const brandTagFormat = winston.format((info) => {
  const extraTags = [];
  if (info.brand) extraTags.push(`brand:${info.brand}`);
  if (info.team)  extraTags.push(`team:${info.team}`);
  if (extraTags.length) {
    info.ddtags = `${DD_BASE_TAGS},${extraTags.join(',')}`;
  } else {
    info.ddtags = DD_BASE_TAGS;
  }
  return info;
})();

const logTransports = [new winston.transports.Console()];
if (process.env.DD_API_KEY) {
  logTransports.push(new DatadogWinston({
    apiKey:   process.env.DD_API_KEY,
    hostname: CUSTOMER.hostname,
    service:  CUSTOMER.platform,
    ddsource: 'nodejs',
    ddtags:   DD_BASE_TAGS,
  }));
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), brandTagFormat, winston.format.json()),
  transports: logTransports,
});

// ── DogStatsD ─────────────────────────────────────────────
const dogstatsd = new StatsD({
  host:       process.env.DD_AGENT_HOST || 'datadog-agent',
  port:       8125,
  prefix:     CUSTOMER.metricPrefix + '.',
  globalTags: [`env:${process.env.DD_ENV || 'local'}`, `service:${CUSTOMER.platform}`],
  errorHandler: (err) => logger.warn('StatsD error', { error: err.message }),
});

// ── Brand Configuration ───────────────────────────────────
const BRANDS = Object.fromEntries(CUSTOMER.brands.map(b => [b.key, b]));

const BRAND_KEYS = Object.keys(BRANDS);

// ── In-memory state ───────────────────────────────────────
const brandOrders  = Object.fromEntries(BRAND_KEYS.map(b => [b, []]));
const brandMetrics = Object.fromEntries(BRAND_KEYS.map(b => [b, {
  totalOrders:    0,
  totalRevenue:   0,
  loyaltyLookups: 0,
  errors:         0,
}]));

// ── Feature Flags ─────────────────────────────────────────
const FLAGS = {};

for (const brand of BRAND_KEYS) {
  FLAGS[`${brand}-pos-outage`] = {
    enabled:     false,
    description: `POS system outage for ${BRANDS[brand].name} — all orders return 503`,
    impact:      'availability',
    brand,
  };
  FLAGS[`${brand}-slow-pos`] = {
    enabled:     false,
    description: `Slow POS for ${BRANDS[brand].name} — 3× transaction latency`,
    impact:      'latency',
    brand,
  };
}

FLAGS['loyalty-degraded'] = {
  enabled:     false,
  description: 'Loyalty service degraded across all brands — elevated lookup failures & latency',
  impact:      'errors',
  brand:       null,
};
FLAGS['delivery-surge'] = {
  enabled:     false,
  description: 'Delivery surge — 3× estimated wait times across all brands',
  impact:      'latency',
  brand:       null,
};

// ── Helpers ───────────────────────────────────────────────
function tagBrand(brand) {
  const b = BRANDS[brand];
  if (!b) return;
  const span = tracer.scope().active();
  if (span) {
    span.setTag('brand',      brand);
    span.setTag('brand.name', b.name);
    span.setTag('team',       b.team);
  }
}

function evalFlag(name) {
  const flag = FLAGS[name];
  if (!flag) return false;
  const tags = [`flag_name:${name}`, `flag_value:${flag.enabled}`, `impact:${flag.impact}`];
  if (flag.brand) tags.push(`brand:${flag.brand}`, `team:${BRANDS[flag.brand].team}`);
  dogstatsd.increment('feature_flag.evaluation', 1, tags);
  return flag.enabled;
}

// ── App ───────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Request middleware ────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const brand    = req.params?.brand;
    const brandTags = brand && BRANDS[brand]
      ? [`brand:${brand}`, `team:${BRANDS[brand].team}`]
      : [];
    const span = tracer.scope().active();

    logger.info('http.request', {
      method:      req.method,
      path:        req.path,
      status:      res.statusCode,
      duration_ms: duration,
      brand:       brand || undefined,
      team:        brand ? BRANDS[brand]?.team : undefined,
      trace_id:    span ? span.context().toTraceId() : undefined,
    });

    dogstatsd.histogram('http.response_time', duration, [
      `method:${req.method}`,
      `path:${req.path.replace(/\/[a-z-]+\//g, '/:brand/').replace(/\/\d+/g, '/:id')}`,
      `status:${res.statusCode}`,
      ...brandTags,
    ]);
    dogstatsd.increment('http.requests', 1, [
      `method:${req.method}`,
      `status:${res.statusCode}`,
      ...brandTags,
    ]);
  });
  next();
});

// ── Health ────────────────────────────────────────────────
app.get('/health', (req, res) => {
  dogstatsd.gauge('platform.up', 1);
  res.json({
    status:    'ok',
    service:   CUSTOMER.platform,
    brands:    BRAND_KEYS.length,
    timestamp: new Date().toISOString(),
  });
});

// ── Brands list (powers the UI dashboard) ────────────────
app.get('/api/brands', (req, res) => {
  const result = BRAND_KEYS.map(key => {
    const b   = BRANDS[key];
    const m   = brandMetrics[key];
    const outage = FLAGS[`${key}-pos-outage`].enabled;
    const slow   = FLAGS[`${key}-slow-pos`].enabled;
    const status = outage ? 'outage' : slow ? 'degraded' : 'healthy';
    return {
      key,
      name:     b.name,
      color:    b.color,
      team:     b.team,
      tagline:  b.tagline,
      channels: b.channels,
      status,
      metrics: {
        totalOrders:    m.totalOrders,
        totalRevenue:   +m.totalRevenue.toFixed(2),
        loyaltyLookups: m.loyaltyLookups,
        errors:         m.errors,
      },
    };
  });

  const totalOrders  = result.reduce((s, b) => s + b.metrics.totalOrders,  0);
  const totalRevenue = result.reduce((s, b) => s + b.metrics.totalRevenue, 0);
  const totalErrors  = result.reduce((s, b) => s + b.metrics.errors,       0);

  res.json({
    brands: result,
    platform: { totalOrders, totalRevenue: +totalRevenue.toFixed(2), totalErrors },
  });
});

// ── Brand menu ────────────────────────────────────────────
app.get('/api/:brand/menu', (req, res) => {
  const { brand } = req.params;
  if (!BRANDS[brand]) return res.status(404).json({ error: `Unknown brand: ${brand}` });

  tagBrand(brand);
  const b = BRANDS[brand];
  logger.info('menu.fetched', { brand, team: b.team, item_count: b.menu.length });
  dogstatsd.increment('menu.requests', 1, [`brand:${brand}`, `team:${b.team}`]);
  res.json({ brand: b.name, items: b.menu, channels: b.channels });
});

// ── Create order ──────────────────────────────────────────
app.post('/api/:brand/orders', async (req, res) => {
  const { brand } = req.params;
  if (!BRANDS[brand]) return res.status(404).json({ error: `Unknown brand: ${brand}` });

  const b = BRANDS[brand];
  tagBrand(brand);

  if (evalFlag(`${brand}-pos-outage`)) {
    brandMetrics[brand].errors++;
    logger.error('pos.outage', { brand, team: b.team, message: 'POS system unavailable — flag active' });
    dogstatsd.increment('pos.errors', 1, [`brand:${brand}`, `team:${b.team}`, 'error_type:outage']);
    return res.status(503).json({ error: 'POS system temporarily unavailable', brand: b.name, retry_after: 30 });
  }

  // Child span with brand-specific service name — surfaces as a separate APM service
  await tracer.trace('pos.create_order', {
    service:  `${CUSTOMER.servicePrefix}-${brand}-pos`,
    resource: `POST /api/${brand}/orders`,
    type:     'web',
  }, async (span) => {
    span.setTag('brand', brand);
    span.setTag('team',  b.team);

    const slowPos  = evalFlag(`${brand}-slow-pos`);
    const baseMs   = Math.floor(Math.random() * 300) + 50;
    const delayMs  = slowPos ? baseMs * 3 : baseMs;
    await new Promise(r => setTimeout(r, delayMs));

    const { channel = 'in-store', loyaltyId, itemId } = req.body;
    const item     = (itemId && b.menu.find(m => m.id === itemId)) || b.menu[Math.floor(Math.random() * b.menu.length)];
    const quantity = req.body.quantity || 1;

    const order = {
      id:           uuidv4(),
      brand,
      brandName:    b.name,
      item:         item.name,
      itemId:       item.id,
      quantity,
      total:        +(item.price * quantity).toFixed(2),
      channel,
      loyaltyId:    loyaltyId || null,
      status:       'confirmed',
      processingMs: delayMs,
      createdAt:    new Date().toISOString(),
    };

    brandOrders[brand].push(order);
    brandMetrics[brand].totalOrders++;
    brandMetrics[brand].totalRevenue += order.total;

    span.setTag('order.total', order.total);
    span.setTag('channel',     channel);
    span.setTag('slow_pos',    slowPos);

    logger.info('order.created', {
      brand, team: b.team, orderId: order.id, item: order.item,
      total: order.total, channel, slow_pos: slowPos, processing_ms: delayMs,
    });

    dogstatsd.increment('orders.created',      1,           [`brand:${brand}`, `team:${b.team}`, `channel:${channel}`]);
    dogstatsd.histogram('orders.value',        order.total, [`brand:${brand}`, `team:${b.team}`]);
    dogstatsd.histogram('pos.processing_time', delayMs,     [`brand:${brand}`, `team:${b.team}`, `slow_pos:${slowPos}`]);

    res.status(201).json(order);
  });
});

// ── Orders list ───────────────────────────────────────────
app.get('/api/:brand/orders', (req, res) => {
  const { brand } = req.params;
  if (!BRANDS[brand]) return res.status(404).json({ error: `Unknown brand: ${brand}` });
  tagBrand(brand);
  const orders = brandOrders[brand];
  dogstatsd.gauge('orders.total', orders.length, [`brand:${brand}`, `team:${BRANDS[brand].team}`]);
  res.json({ brand: BRANDS[brand].name, orders, total: orders.length });
});

// ── Loyalty lookup ────────────────────────────────────────
app.get('/api/:brand/loyalty/:userId', async (req, res) => {
  const { brand, userId } = req.params;
  if (!BRANDS[brand]) return res.status(404).json({ error: `Unknown brand: ${brand}` });

  const b        = BRANDS[brand];
  const degraded = evalFlag('loyalty-degraded');
  tagBrand(brand);
  brandMetrics[brand].loyaltyLookups++;

  // Child span surfaces as {servicePrefix}-{brand}-loyalty in APM service map
  await tracer.trace('loyalty.member_lookup', {
    service:  `${CUSTOMER.servicePrefix}-${brand}-loyalty`,
    resource: `GET /api/${brand}/loyalty/:userId`,
    type:     'web',
  }, async (span) => {
    span.setTag('brand',    brand);
    span.setTag('team',     b.team);
    span.setTag('degraded', degraded);

    const baseMs  = Math.floor(Math.random() * 200) + 20;
    const delayMs = degraded ? baseMs * 4 + Math.floor(Math.random() * 400) : baseMs;
    await new Promise(r => setTimeout(r, delayMs));

    if (degraded && Math.random() < 0.4) {
      brandMetrics[brand].errors++;
      span.setTag('error', true);
      logger.error('loyalty.lookup_failed', { brand, team: b.team, userId, degraded: true });
      dogstatsd.increment('loyalty.errors', 1, [`brand:${brand}`, `team:${b.team}`]);
      return res.status(502).json({ error: 'Loyalty service temporarily unavailable', degraded: true });
    }

    const points = Math.floor(Math.random() * 5000) + 100;
    const tier   = points > 3000 ? 'Gold' : points > 1000 ? 'Silver' : 'Bronze';

    span.setTag('loyalty.tier',   tier);
    span.setTag('loyalty.points', points);

    logger.info('loyalty.lookup', { brand, team: b.team, userId, points, tier, latency_ms: delayMs });
    dogstatsd.histogram('loyalty.lookup_latency', delayMs, [`brand:${brand}`, `team:${b.team}`, `tier:${tier.toLowerCase()}`]);
    dogstatsd.gauge('loyalty.member_points',      points,   [`brand:${brand}`, `team:${b.team}`, `tier:${tier.toLowerCase()}`]);

    res.json({ brand: b.name, userId, points, tier, memberSince: '2021-03-15', degraded });
  });
});

// ── Delivery estimate ─────────────────────────────────────
app.get('/api/:brand/delivery/estimate', async (req, res) => {
  const { brand } = req.params;
  if (!BRANDS[brand]) return res.status(404).json({ error: `Unknown brand: ${brand}` });

  const b    = BRANDS[brand];
  const surge = evalFlag('delivery-surge');
  tagBrand(brand);

  // Child span surfaces as {servicePrefix}-{brand}-delivery in APM service map
  await tracer.trace('delivery.get_estimate', {
    service:  `${CUSTOMER.servicePrefix}-${brand}-delivery`,
    resource: `GET /api/${brand}/delivery/estimate`,
    type:     'web',
  }, async (span) => {
    span.setTag('brand',  brand);
    span.setTag('team',   b.team);
    span.setTag('surge',  surge);

    const baseEta = Math.floor(Math.random() * 15) + 20;
    const eta     = surge ? Math.floor(baseEta * 3) : baseEta;

    span.setTag('delivery.eta_min', eta);

    logger.info('delivery.estimate', { brand, team: b.team, eta_min: eta, surge });
    dogstatsd.histogram('delivery.eta', eta, [`brand:${brand}`, `team:${b.team}`, `surge:${surge}`]);

    res.json({
      brand:            b.name,
      estimatedMinutes: eta,
      surge,
      message: surge ? 'High demand — extended delivery times in effect' : null,
    });
  });
});

// ── Log flood (brand-aware) ───────────────────────────────
app.post('/api/logs/flood', (req, res) => {
  const count       = Math.min(parseInt(req.body?.count ?? 50), 200);
  const targetBrand = req.body?.brand;
  const pool        = targetBrand && BRANDS[targetBrand] ? [targetBrand] : BRAND_KEYS;

  const TEMPLATES = [
    { level: 'info',  msg: 'Order payment processed',           extras: b => ({ orderId: uuidv4(), amount: +(Math.random() * 80).toFixed(2), brand: b, team: BRANDS[b].team, channel: BRANDS[b].channels[0] }) },
    { level: 'info',  msg: 'Loyalty member points updated',     extras: b => ({ userId: Math.ceil(Math.random() * 1000), points_added: Math.floor(Math.random() * 100), brand: b, team: BRANDS[b].team }) },
    { level: 'info',  msg: 'Menu cache refreshed',              extras: b => ({ brand: b, team: BRANDS[b].team, item_count: BRANDS[b].menu.length, ttl_ms: 300000 }) },
    { level: 'info',  msg: 'POS terminal heartbeat',            extras: b => ({ brand: b, team: BRANDS[b].team, terminal_id: `POS-${Math.floor(Math.random() * 99) + 1}`, location: 'store-001' }) },
    { level: 'info',  msg: 'Mobile order placed',               extras: b => ({ brand: b, team: BRANDS[b].team, orderId: uuidv4(), channel: 'mobile-order' }) },
    { level: 'warn',  msg: 'Slow POS transaction detected',     extras: b => ({ brand: b, team: BRANDS[b].team, duration_ms: Math.floor(Math.random() * 3000) + 500, threshold_ms: 500 }) },
    { level: 'warn',  msg: 'Low inventory alert',               extras: b => ({ brand: b, team: BRANDS[b].team, item: BRANDS[b].menu[0].name, stock: Math.floor(Math.random() * 10) }) },
    { level: 'warn',  msg: 'Loyalty service latency elevated',  extras: b => ({ brand: b, team: BRANDS[b].team, latency_ms: Math.floor(Math.random() * 2000) + 400 }) },
    { level: 'warn',  msg: 'Delivery partner response slow',    extras: b => ({ brand: b, team: BRANDS[b].team, partner: 'doordash', response_ms: Math.floor(Math.random() * 5000) + 1000 }) },
    { level: 'error', msg: 'Payment gateway timeout',           extras: b => ({ brand: b, team: BRANDS[b].team, gateway: 'stripe', timeout_ms: 5000, orderId: uuidv4() }) },
    { level: 'error', msg: 'POS terminal offline',              extras: b => ({ brand: b, team: BRANDS[b].team, terminal_id: `POS-${Math.floor(Math.random() * 99) + 1}`, last_seen_ms: 120000 }) },
    { level: 'error', msg: 'Delivery partner API failure',      extras: b => ({ brand: b, team: BRANDS[b].team, partner: 'doordash', http_status: 503 }) },
    { level: 'error', msg: 'Loyalty DB connection pool exhausted', extras: b => ({ brand: b, team: BRANDS[b].team, pool_size: 10, waiting: Math.floor(Math.random() * 20) + 10 }) },
  ];

  const fired = [];
  for (let i = 0; i < count; i++) {
    const brand = pool[Math.floor(Math.random() * pool.length)];
    const tpl   = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
    logger[tpl.level](tpl.msg, { ...tpl.extras(brand), flood_batch: true, seq: i + 1 });
    fired.push({ level: tpl.level, brand });
  }

  dogstatsd.increment('logs.flood.triggered', count);
  res.json({
    ok:       true,
    fired:    count,
    breakdown: ['info', 'warn', 'error'].map(l => ({
      level: l,
      count: fired.filter(f => f.level === l).length,
    })),
    brandBreakdown: BRAND_KEYS.map(b => ({
      brand: b,
      count: fired.filter(f => f.brand === b).length,
    })),
  });
});

// ── Feature flags ─────────────────────────────────────────
app.get('/api/flags', (req, res) => {
  const result = Object.entries(FLAGS).map(([name, cfg]) => ({
    name,
    enabled:     cfg.enabled,
    description: cfg.description,
    impact:      cfg.impact,
    brand:       cfg.brand,
  }));
  res.json({ flags: result });
});

app.post('/api/flags/:name/toggle', (req, res) => {
  const { name } = req.params;
  if (!FLAGS[name]) return res.status(404).json({ error: `Unknown flag: ${name}` });

  FLAGS[name].enabled = !FLAGS[name].enabled;
  const newValue = FLAGS[name].enabled;
  const flag     = FLAGS[name];

  logger.info('feature_flag.toggled', {
    flag_name:  name,
    flag_value: newValue,
    impact:     flag.impact,
    brand:      flag.brand,
    team:       flag.brand ? BRANDS[flag.brand].team : 'platform',
  });
  dogstatsd.increment('feature_flag.toggled', 1, [
    `flag_name:${name}`,
    `flag_value:${newValue}`,
    `impact:${flag.impact}`,
    ...(flag.brand ? [`brand:${flag.brand}`, `team:${BRANDS[flag.brand].team}`] : []),
  ]);

  res.json({ name, enabled: newValue, description: flag.description });
});

// ── AI Assistant (LLM Observability demo) ────────────────
function buildSystemPrompt() {
  const brandStatus = BRAND_KEYS.map(key => {
    const b = BRANDS[key];
    const m = brandMetrics[key];
    const outage = FLAGS[`${key}-pos-outage`].enabled;
    const slow   = FLAGS[`${key}-slow-pos`].enabled;
    const status = outage ? '🔴 POS OUTAGE' : slow ? '🟡 Slow POS (3× latency)' : '🟢 Healthy';
    return `  - ${b.name} (team:${b.team}): ${status} | orders:${m.totalOrders} revenue:$${m.totalRevenue.toFixed(2)} errors:${m.errors}`;
  }).join('\n');

  const extras = [
    FLAGS['loyalty-degraded'].enabled ? '  ⚠️  loyalty-degraded: ON — 40% lookup failure rate across all brands' : null,
    FLAGS['delivery-surge'].enabled   ? '  ⚠️  delivery-surge: ON — 3× ETAs across all brands' : null,
  ].filter(Boolean).join('\n');

  const svcPfx     = CUSTOMER.servicePrefix;
  const brandCount = BRAND_KEYS.length;
  const svcCount   = 1 + brandCount * 3;
  const monCount   = brandCount * 3 + 3;
  const brandList  = BRAND_KEYS.map(k => BRANDS[k].name).join(', ');
  const teamList   = BRAND_KEYS.map(k => BRANDS[k].team).join(', ');

  return `You are the ${CUSTOMER.company} Digital Operations Assistant — an AI embedded in the live Datadog observability demo platform.

CURRENT PLATFORM STATUS:
${brandStatus}
${extras || '  ✅ No active incidents'}

PLATFORM ARCHITECTURE:
- ${brandCount} brands: ${brandList}
- Each brand has a dedicated Datadog team (${teamList})
- 3 APM services per brand: ${svcPfx}-{brand}-pos, ${svcPfx}-{brand}-loyalty, ${svcPfx}-{brand}-delivery
- ${svcCount} services total in the Datadog Service Catalog with team ownership
- ${monCount} monitors: 3 per brand (POS errors, POS p95 latency, order volume anomaly) + 3 cross-brand
- ${1 + brandCount} synthetic tests: platform health check + POS order test per brand
- Unified tagging: brand:, team:, channel:, env:, service:

DATADOG FEATURES IN THIS DEMO:
- Teams: Brand-level ownership and alert routing — each brand's monitors alert to its team
- APM Service Map: Shows ${svcCount} services with parent-child relationships by brand
- Service Catalog: Full service registry with team ownership, descriptions, and dashboard links
- Monitors: Per-brand POS health + cross-brand shared-service monitors
- Synthetics: Automated order placement tests per brand
- Log Management: Structured logs tagged by brand and team, searchable in real time
- LLM Observability: This very conversation is being traced in Datadog! (ml_app: ${CUSTOMER.mlApp})

DEMO SCENARIOS (available in the UI):
- POS Outage (per brand): toggle flag → 503 errors → POS error monitor fires → routes to brand team
- Slow POS (per brand): toggle flag → 3× latency → p95 monitor fires
- Loyalty Degraded (all brands): shared service failure impacting all ${brandCount} brands simultaneously
- Delivery Surge (all brands): 3× ETAs → delivery SLO monitor fires

Be conversational, specific, and demo-ready. Reference exact Datadog URLs and features when helpful. Keep answers to 2-4 sentences unless a longer explanation is needed.`;
}

// ── Smart mock — context-aware responses from live state ──
function mockResponse(message) {
  const q          = message.toLowerCase();
  const now        = new Date().toLocaleTimeString();
  const svcPfx     = CUSTOMER.servicePrefix;
  const brandCount = BRAND_KEYS.length;
  const svcCount   = 1 + brandCount * 3;
  const monCount   = brandCount * 3 + 3;
  const brandList  = BRAND_KEYS.map(k => BRANDS[k].name).join(', ');

  const liveStatus = BRAND_KEYS.map(key => {
    const b = BRANDS[key];
    const m = brandMetrics[key];
    const outage = FLAGS[`${key}-pos-outage`].enabled;
    const slow   = FLAGS[`${key}-slow-pos`].enabled;
    const icon   = outage ? '🔴' : slow ? '🟡' : '🟢';
    return `• ${icon} **${b.name}** — ${outage ? 'POS OUTAGE' : slow ? 'Slow POS (3× latency)' : 'Healthy'} | ${m.totalOrders} orders | $${m.totalRevenue.toFixed(2)} revenue`;
  }).join('\n');

  const activeFlags = Object.entries(FLAGS)
    .filter(([, f]) => f.enabled)
    .map(([name, f]) => `⚠️ \`${name}\` — ${f.description}`)
    .join('\n') || '✅ No active incidents';

  if (q.includes('status') || q.includes('health') || q.includes('all brand') || q.includes('current')) {
    return `Here's the live platform status as of **${now}**:\n\n${liveStatus}\n\n**Active Incidents:**\n${activeFlags}\n\nAll metrics are flowing into Datadog in real time — tagged by \`brand:\`, \`team:\`, and \`channel:\` so each brand's ops team sees only their signals.`;
  }

  if (q.includes('team') || q.includes('ownership') || q.includes('routing')) {
    const teamHandles = BRAND_KEYS.map(k => `\`${BRANDS[k].team}\``).join(', ');
    return `Datadog Teams gives each brand its own operational identity. The platform has **${brandCount + 1} teams**: \`${CUSTOMER.platformTeam}\` for shared infrastructure, plus one per brand — ${teamHandles}.\n\nEvery monitor is tagged \`team:<brand>-ops\`, so alerts route directly to the right team's Slack channel. The Service Catalog maps all ${svcCount} APM services to their owning team, so there's no ambiguity about who's on-call for what.`;
  }

  if (q.includes('outage') || q.includes('trigger') || q.includes('incident') || q.includes('simulate')) {
    const targetKey = BRAND_KEYS.find(k => q.includes(k) || q.includes(BRANDS[k].name.toLowerCase())) || BRAND_KEYS[0];
    const b = BRANDS[targetKey];
    return `When you trigger a **${b.name} POS outage** using the demo panel, the \`${targetKey}-pos-outage\` feature flag flips to \`true\`. All POST /api/${targetKey}/orders calls immediately return **HTTP 503**, and the DogStatsD metric \`${svcPfx}.pos.errors{brand:${targetKey}}\` starts climbing.\n\nWithin ~30 seconds, the monitor **[${b.name}] POS Error Rate > 5 errors in 5m** fires. The alert routes to \`${b.team}\` with the triage runbook already embedded in the notification.`;
  }

  if (q.includes('tag') || q.includes('tagging') || q.includes('unified service')) {
    return `The platform uses **Datadog Unified Service Tagging** across every signal:\n\n• \`service:${CUSTOMER.platform}\` — the top-level service\n• \`brand:<key>\` — e.g. \`brand:${BRAND_KEYS[0]}\`, \`brand:${BRAND_KEYS[1]}\`\n• \`team:<brand>-ops\` — ownership tag for alert routing\n• \`channel:<channel>\` — e.g. \`channel:drive-thru\`, \`channel:delivery\`\n• \`env:local\` + \`version:1.0.0\` — standard UST tags\n\nAll metrics, logs, and APM traces carry the same tag set, which means you can pivot from a log error → correlated trace → owning team without any manual correlation.`;
  }

  if (q.includes('monitor') || q.includes('alert') || q.includes('slo')) {
    return `The platform has **${monCount} monitors** across 3 categories:\n\n**Per-brand (${brandCount * 3} monitors):** Each of the ${brandCount} brands has:\n• POS Error Rate > 5 errors/5min (P2)\n• POS p95 Latency > 1500ms (P3)\n• Anomalous Order Volume — anomaly detection (P3)\n\n**Cross-brand (3 monitors):**\n• Platform-Wide Error Rate > 20 HTTP 500s/5min (P1)\n• Loyalty Service Errors > 10/5min — impacts all ${brandCount} brands (P2)\n• Delivery ETA p95 > 60 minutes (P2)\n\nAll monitors have embedded runbooks, Slack routing, and brand-specific triage steps.`;
  }

  if (q.includes('apm') || q.includes('service map') || q.includes('trace') || q.includes('service')) {
    return `APM shows **${svcCount} services** in the service map. The platform service \`${CUSTOMER.platform}\` is the parent, with 3 child services per brand: \`${svcPfx}-<brand>-pos\`, \`${svcPfx}-<brand>-loyalty\`, and \`${svcPfx}-<brand>-delivery\`.\n\nEach brand's services are separated using \`tracer.trace()\` with a custom \`service:\` override — so one brand's POS errors never inflate another's error rate. In the APM Service Map you'll see the ${brandCount} brands fanning out from the platform with clear parent-child relationships.`;
  }

  if (q.includes('log') || q.includes('logging')) {
    return `Every API call emits a structured JSON log with \`brand\`, \`team\`, \`trace_id\`, and \`duration_ms\` fields. Logs are shipped directly to Datadog via \`datadog-winston\`, correlated with APM traces via log injection.\n\nIn Log Management, filter by \`brand:${BRAND_KEYS[0]}\` to see only ${BRANDS[BRAND_KEYS[0]].name}'s logs. The Log Flood button sends a burst of realistic mixed-level logs across all brands — great for demonstrating log search and faceting.`;
  }

  if (q.includes('loyalty') || q.includes('delivery') || q.includes('shared service')) {
    return `Loyalty and Delivery are **shared services** — they span all ${brandCount} brands. When you toggle **Loyalty Degraded**, all brands simultaneously experience a 40% lookup failure rate and 4× latency, because they all call the same \`${svcPfx}-<brand>-loyalty\` APM services backed by the same upstream.\n\nThis demonstrates how a single shared service failure cascades across an entire brand portfolio — and why the Loyalty monitor fires once at the platform level rather than ${brandCount} times.`;
  }

  if (q.includes('cost') || q.includes('spend') || q.includes('usage') || q.includes('budget')) {
    return `The Global Operations Dashboard includes a **Cost & Observability Spend** section showing log ingestion trends, custom metric counts, and a derived Cost/Order metric — infrastructure spend normalized by order volume.\n\nFor full cost allocation by brand/team, go to [Cloud Cost Management](https://app.datadoghq.com/cost/summary). Because every metric is tagged \`team:<brand>-ops\`, you can filter costs by team to see per-brand observability spend.`;
  }

  if (q.includes('data') || q.includes('pipeline') || q.includes('quality') || q.includes('freshness')) {
    return `The platform emits **Data Observability metrics** every 15 seconds per brand:\n\n• \`${svcPfx}.data.quality_score\` — 0–100, degrades automatically during POS outages\n• \`${svcPfx}.data.menu_sync_age_seconds\` — cycles every ~5 minutes, alerts if stale >4 min\n• \`${svcPfx}.data.inventory_lag_ms\` — inventory sync latency with realistic jitter\n• \`${svcPfx}.data.pipeline_queue_depth\` — surges 3× during Delivery Surge scenarios`;
  }

  if (q.includes('synthetic') || q.includes('synthetics')) {
    return `There are **${1 + brandCount} synthetic tests** running: one platform health check on GET /health, plus one POS order test per brand that places a real POST /api/<brand>/orders request every few minutes.\n\nWhen a POS outage flag is active, the synthetic immediately starts failing — giving you a true end-to-end availability signal independent of metrics.`;
  }

  return `Great question about the ${CUSTOMER.company} platform! This demo spans **${brandCount} brands** (${brandList}) with full Datadog coverage: APM (${svcCount} services), ${monCount} monitors with P1–P3 triage runbooks, ${brandCount} brand SLOs, synthetics, structured logs, data pipeline observability, and cost attribution.\n\nTry asking about: brand status, Teams ownership, the tagging strategy, APM service map, monitors and SLOs, loyalty/delivery shared services, or triggering an outage scenario.`;
}

app.post('/api/chat', async (req, res) => {
  const { message, brand, sessionId = `demo-${Date.now()}` } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  const systemPrompt = buildSystemPrompt();
  const brandTag     = brand || 'platform';

  try {
    let assistantMessage = '';
    let usage            = { input_tokens: 0, output_tokens: 0 };

    if (ANTHROPIC_KEY && Anthropic) {
      // ── Real Claude path ────────────────────────────────
      const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

      await LLMObs.trace({
        kind: 'llm', name: 'platform_chat',
        modelName: 'claude-sonnet-4-6', modelProvider: 'anthropic',
        sessionId, mlApp: CUSTOMER.mlApp,
      }, async (span) => {
        span.setTag('brand', brandTag);
        span.setTag('session_id', sessionId);
        span.setTag('mock', false);

        const response = await client.messages.create({
          model: 'claude-sonnet-4-6', max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: message }],
        });

        assistantMessage = response.content[0].text;
        usage            = response.usage;

        LLMObs.annotate(span, {
          inputMessages:  [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
          outputMessages: [{ role: 'assistant', content: assistantMessage }],
          metadata: { brand: brandTag, sessionId, mock: false },
          metrics: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.input_tokens + usage.output_tokens },
        });
      });

    } else {
      // ── Smart mock path — still creates real LLMObs spans ──
      await new Promise(r => setTimeout(r, 400 + Math.random() * 600)); // realistic latency
      assistantMessage = mockResponse(message);
      usage = {
        input_tokens:  Math.floor(systemPrompt.length / 4) + Math.floor(message.length / 4),
        output_tokens: Math.floor(assistantMessage.length / 4),
      };

      if (LLMObs && typeof LLMObs.trace === 'function') {
        await LLMObs.trace({
          kind: 'llm', name: 'platform_chat',
          modelName: CUSTOMER.servicePrefix + '-assistant-v1', modelProvider: CUSTOMER.servicePrefix + '-internal',
          sessionId, mlApp: CUSTOMER.mlApp,
        }, async (span) => {
          span.setTag('brand', brandTag);
          span.setTag('session_id', sessionId);
          span.setTag('mock', true);

          LLMObs.annotate(span, {
            inputMessages:  [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
            outputMessages: [{ role: 'assistant', content: assistantMessage }],
            metadata: { brand: brandTag, sessionId, mock: true },
            metrics: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.input_tokens + usage.output_tokens },
          });
        });
      }
    }

    dogstatsd.increment('llm.requests',      1,                   [`brand:${brandTag}`, `model:${CUSTOMER.servicePrefix}-assistant-v1`, `app:${CUSTOMER.mlApp}`]);
    dogstatsd.histogram('llm.input_tokens',  usage.input_tokens,  [`brand:${brandTag}`]);
    dogstatsd.histogram('llm.output_tokens', usage.output_tokens, [`brand:${brandTag}`]);

    logger.info('llm.chat_completion', {
      brand: brandTag, sessionId, mock: !(ANTHROPIC_KEY && Anthropic),
      input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
    });

    res.json({ message: assistantMessage, usage, sessionId });

  } catch (e) {
    logger.error('llm.chat_error', { error: e.message, brand: brandTag, sessionId });
    res.status(500).json({ error: 'Chat completion failed', details: e.message });
  }
});

// ── Security demo endpoints (ASM) ────────────────────────
// These endpoints intentionally accept user-controlled input so ASM can detect
// and block common attack patterns (SQLi, XSS, path traversal) in demo scenarios.
app.get('/api/security/scan', (req, res) => {
  const { q = '', user_id = '' } = req.query;
  const span = tracer.scope().active();
  if (span) {
    span.setTag('security.demo', true);
    span.setTag('query_param', q.slice(0, 100));
  }
  logger.info('security.scan_request', { query: q, user_id, ip: req.ip });
  dogstatsd.increment('security.scan_requests', 1, ['endpoint:search']);
  res.json({ results: [], query: q, user_id, timestamp: new Date().toISOString() });
});

app.post('/api/security/login', (req, res) => {
  const { username = '', password = '' } = req.body;
  const span = tracer.scope().active();
  if (span) span.setTag('security.demo', true);
  logger.info('security.login_attempt', { username, ip: req.ip });
  dogstatsd.increment('security.login_attempts', 1);
  // Simulate auth — always returns success for demo
  const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
  res.json({ token, username, authenticated: true });
});

app.get('/api/security/file', (req, res) => {
  const { path: filePath = 'menu.json' } = req.query;
  const span = tracer.scope().active();
  if (span) {
    span.setTag('security.demo', true);
    span.setTag('requested_path', filePath.slice(0, 200));
  }
  logger.info('security.file_request', { path: filePath, ip: req.ip });
  dogstatsd.increment('security.file_requests', 1, ['endpoint:file']);
  res.json({ file: filePath, content: 'demo content', timestamp: new Date().toISOString() });
});

// ── Presenter (admin demo controls) ──────────────────────
app.get('/presenter', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'presenter.html'));
});

// ── Brand web apps ────────────────────────────────────────
app.get('/inspire', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'brands', 'inspire.html'));
});

app.get('/brands/:brand', (req, res) => {
  const { brand } = req.params;
  if (!BRANDS[brand]) return res.status(404).send('Brand not found');
  res.sendFile(path.join(__dirname, 'public', 'brands', 'app.html'));
});

// Catch-all → SPA
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Data Observability Pipeline Metrics ──────────────────
const DATA_PIPELINE = Object.fromEntries(BRAND_KEYS.map(b => [b, {
  menuSyncAge:   Math.random() * 60  + 30,
  inventoryLag:  Math.random() * 200 + 50,
  queueDepth:    Math.floor(Math.random() * 50)  + 10,
  qualityScore:  Math.random() * 10  + 89,
  etlRows:       Math.floor(Math.random() * 1000) + 500,
}]));

setInterval(() => {
  let platformQueueTotal = 0;

  BRAND_KEYS.forEach(brand => {
    const b     = BRANDS[brand];
    const state = DATA_PIPELINE[brand];
    const tags  = [`brand:${brand}`, `team:${b.team}`];

    // Menu sync freshness cycles every ~5 min
    state.menuSyncAge = (state.menuSyncAge + 15) % 290;

    // Inventory lag drifts with noise
    state.inventoryLag = Math.max(30, state.inventoryLag + (Math.random() - 0.5) * 80);

    // Queue depth fluctuates; surges during delivery-surge flag
    const surgeFactor = FLAGS['delivery-surge'].enabled ? 3 : 1;
    state.queueDepth  = Math.max(0, Math.floor(state.queueDepth + (Math.random() - 0.4) * 15 * surgeFactor));
    platformQueueTotal += state.queueDepth;

    // ETL throughput
    state.etlRows = Math.floor(Math.random() * 1000) + 500;

    // Quality score degrades during outages / degraded flags
    const hasIssue = FLAGS[`${brand}-pos-outage`]?.enabled || FLAGS['loyalty-degraded']?.enabled;
    state.qualityScore = hasIssue
      ? Math.max(65, state.qualityScore - Math.random() * 3)
      : Math.min(99.5, state.qualityScore + Math.random() * 1.5);

    dogstatsd.gauge('data.menu_sync_age_seconds',  state.menuSyncAge,  tags);
    dogstatsd.gauge('data.inventory_lag_ms',        state.inventoryLag, tags);
    dogstatsd.gauge('data.pipeline_queue_depth',    state.queueDepth,   tags);
    dogstatsd.gauge('data.quality_score',           state.qualityScore, tags);
    dogstatsd.increment('data.etl_rows_processed',  state.etlRows,      tags);

    if (Math.random() < 0.25) {
      const level = state.qualityScore < 80 ? 'warn' : 'info';
      logger[level]('data.pipeline_health', {
        brand, team: b.team,
        menu_sync_age_seconds: Math.round(state.menuSyncAge),
        inventory_lag_ms:      Math.round(state.inventoryLag),
        queue_depth:           state.queueDepth,
        quality_score:         +state.qualityScore.toFixed(1),
        etl_rows_processed:    state.etlRows,
      });
    }
  });

  dogstatsd.gauge('data.platform_queue_total', platformQueueTotal);
}, 15000);

app.listen(PORT, () => {
  logger.info(`${CUSTOMER.platform} started`, {
    port:   PORT,
    env:    process.env.DD_ENV || 'local',
    brands: BRAND_KEYS.length,
    teams:  [...new Set(BRAND_KEYS.map(b => BRANDS[b].team))],
  });
  dogstatsd.increment('platform.started');
});
