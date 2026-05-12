const CUSTOMER   = require('./customer.config');
const LOCATIONS  = require('./locations.config');

// dd-trace MUST be initialized before any other requires
const tracer = require('dd-trace').init({
  service: CUSTOMER.platform,
  env: process.env.DD_ENV || 'local',
  version: process.env.DD_VERSION || '1.0.0',
  logInjection: true,
  runtimeMetrics: true,
  profiling: true,
  appsec: process.env.DD_APPSEC_ENABLED !== 'false',
});

const ddTrace = require('dd-trace');
const LLMObs  = ddTrace.llmobs;

const express        = require('express');
const path           = require('path');
const winston        = require('winston');
const DatadogWinston = require('datadog-winston');
const StatsD         = require('hot-shots');
const { v4: uuidv4 } = require('uuid');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
let   Anthropic     = null;

// ── PostgreSQL persistence (DBM-instrumented) ─────────────
const { Pool } = require('pg');
const db = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'inspire_brands',
  user:     process.env.PGUSER     || 'inspire',
  password: process.env.PGPASSWORD || 'inspire_pw',
  max: 5,
});
let dbReady = false;

async function dbQuery(sql, params = []) {
  if (!dbReady) return null;
  try { return await db.query(sql, params); }
  catch (e) { console.warn('db query error:', e.message); return null; }
}

// Enable LLMObs — guard in case dd-trace version doesn't export it
if (LLMObs && typeof LLMObs.enable === 'function') {
  LLMObs.enable({
    mlApp:            CUSTOMER.mlApp,
    agentlessEnabled: true,
    apiKey:           process.env.DD_API_KEY,
    site:             process.env.DD_SITE || 'datadoghq.com',
  });
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
  if (info.brand)    extraTags.push(`brand:${info.brand}`);
  if (info.team)     extraTags.push(`team:${info.team}`);
  if (info.region)   extraTags.push(`region:${info.region}`);
  if (info.state)    extraTags.push(`state:${info.state}`);
  if (info.store_id) extraTags.push(`store_id:${info.store_id}`);
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

// ── Store location helpers ────────────────────────────────
function pickStore(brand) {
  const stores = LOCATIONS[brand];
  if (!stores || !stores.length) return null;
  return stores[Math.floor(Math.random() * stores.length)];
}

function storeTags(store) {
  if (!store) return [];
  return [
    `region:${store.region}`,
    `state:${store.state}`,
    `city:${store.city.toLowerCase().replace(/ /g, '_')}`,
    `store_id:${store.store_id}`,
  ];
}

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
  FLAGS[`${brand}-chaos`] = {
    enabled:     false,
    description: `☢ Full chaos for ${BRANDS[brand].name} — POS outage + slow POS + loyalty down + delivery down + synthetics fail`,
    impact:      'critical',
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

// ── Restore persisted state from DB ──────────────────────
async function restoreState() {
  // Restore feature flags
  const flags = await dbQuery('SELECT key, enabled FROM feature_flags');
  if (flags) {
    for (const row of flags.rows) {
      if (FLAGS[row.key]) FLAGS[row.key].enabled = row.enabled;
    }
    console.log(`✓ Restored ${flags.rows.length} feature flags from DB`);
  }

  // Restore brand metrics (sum today's rows)
  const metrics = await dbQuery(`
    SELECT brand,
           SUM(orders)   AS orders,
           SUM(revenue)  AS revenue,
           SUM(errors)   AS errors
    FROM brand_metrics
    WHERE ts > NOW() - INTERVAL '24 hours'
    GROUP BY brand
  `);
  if (metrics) {
    for (const row of metrics.rows) {
      if (brandMetrics[row.brand]) {
        brandMetrics[row.brand].totalOrders  += parseInt(row.orders  || 0);
        brandMetrics[row.brand].totalRevenue += parseFloat(row.revenue || 0);
        brandMetrics[row.brand].errors       += parseInt(row.errors  || 0);
      }
    }
    console.log(`✓ Restored brand metrics for ${metrics.rows.length} brands from DB`);
  }
}

// ── Periodic metric flush (write deltas to DB every 30s) ──
const _lastFlushed = Object.fromEntries(BRAND_KEYS.map(b => [b, { totalOrders: 0, totalRevenue: 0, errors: 0 }]));

async function flushMetricsToDB() {
  for (const brand of BRAND_KEYS) {
    const m = brandMetrics[brand];
    const l = _lastFlushed[brand];
    const dOrders  = m.totalOrders  - l.totalOrders;
    const dRevenue = m.totalRevenue - l.totalRevenue;
    const dErrors  = m.errors       - l.errors;
    if (dOrders > 0 || dRevenue > 0 || dErrors > 0) {
      await dbQuery(
        'INSERT INTO brand_metrics (brand, orders, revenue, errors) VALUES ($1, $2, $3, $4)',
        [brand, dOrders, +(dRevenue.toFixed(2)), dErrors]
      );
      l.totalOrders  = m.totalOrders;
      l.totalRevenue = m.totalRevenue;
      l.errors       = m.errors;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────
function tagBrand(brand, store) {
  const b = BRANDS[brand];
  if (!b) return;
  const span = tracer.scope().active();
  if (span) {
    span.setTag('brand',      brand);
    span.setTag('brand.name', b.name);
    span.setTag('team',       b.team);
    if (store) {
      span.setTag('region',   store.region);
      span.setTag('state',    store.state);
      span.setTag('city',     store.city);
      span.setTag('store_id', store.store_id);
    }
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
    const chaos  = FLAGS[`${key}-chaos`]?.enabled;
    const outage = FLAGS[`${key}-pos-outage`].enabled;
    const slow   = FLAGS[`${key}-slow-pos`].enabled;
    const status = chaos ? 'chaos' : outage ? 'outage' : slow ? 'degraded' : 'healthy';
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

  const b     = BRANDS[brand];
  const store = pickStore(brand);
  tagBrand(brand, store);

  if (evalFlag(`${brand}-pos-outage`)) {
    brandMetrics[brand].errors++;
    const sTags = storeTags(store);
    logger.error('pos.outage', { brand, team: b.team, message: 'POS system unavailable — flag active', ...(store && { region: store.region, state: store.state, city: store.city, store_id: store.store_id }) });
    dogstatsd.increment('pos.errors', 1, [`brand:${brand}`, `team:${b.team}`, 'error_type:outage', ...sTags]);
    return res.status(503).json({ error: 'POS system temporarily unavailable', brand: b.name, retry_after: 30 });
  }

  const PAYMENT_METHODS = ['credit_card', 'debit_card', 'apple_pay', 'google_pay'];

  // Child span with brand-specific service name — surfaces as a separate APM service
  await tracer.trace('pos.create_order', {
    service:  `${CUSTOMER.servicePrefix}-${brand}-pos`,
    resource: `POST /api/${brand}/orders`,
    type:     'web',
  }, async (span) => {
    span.setTag('brand', brand);
    span.setTag('team',  b.team);
    if (store) {
      span.setTag('region',   store.region);
      span.setTag('state',    store.state);
      span.setTag('city',     store.city);
      span.setTag('store_id', store.store_id);
    }

    // 1. Cache lookup for menu data
    await tracer.trace('cache.menu_lookup', {
      service:  `${CUSTOMER.servicePrefix}-cache`,
      resource: `GET menu:${brand}`,
      type:     'cache',
    }, async (cacheSpan) => {
      const hit = Math.random() > 0.12;
      cacheSpan.setTag('cache.hit', hit);
      cacheSpan.setTag('component', 'redis');
      cacheSpan.setTag('brand', brand);
      dogstatsd.increment('cache.requests', 1, [`brand:${brand}`, `cache:menu`, `hit:${hit}`]);
      await new Promise(r => setTimeout(r, hit ? 1 : 9));
    });

    const slowPos  = evalFlag(`${brand}-slow-pos`);
    const deploying = deployBurstUntil > Date.now();
    const baseMs   = Math.floor(Math.random() * 300) + 50;
    const delayMs  = slowPos ? baseMs * 3 : deploying ? baseMs * 2 : baseMs;
    if (deploying) span.setTag('deployment_burst', true);
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

    // 2. Payment authorization
    const paymentMethod = PAYMENT_METHODS[Math.floor(Math.random() * PAYMENT_METHODS.length)];
    await tracer.trace('payment.process', {
      service:  `${CUSTOMER.servicePrefix}-payments`,
      resource: 'POST /v1/payment_intents',
      type:     'http',
    }, async (paySpan) => {
      paySpan.setTag('payment.amount',   order.total);
      paySpan.setTag('payment.currency', 'usd');
      paySpan.setTag('payment.method',   paymentMethod);
      paySpan.setTag('brand', brand);
      const payLatency = 50 + Math.floor(Math.random() * 150);
      await new Promise(r => setTimeout(r, payLatency));
      const declined = Math.random() < 0.02;
      if (declined) {
        paySpan.setTag('error', true);
        paySpan.setTag('payment.status', 'declined');
        dogstatsd.increment('payment.declined', 1, [`brand:${brand}`, `method:${paymentMethod}`]);
      } else {
        paySpan.setTag('payment.status', 'authorized');
        dogstatsd.increment('payment.authorized', 1, [`brand:${brand}`, `method:${paymentMethod}`]);
      }
      dogstatsd.histogram('payment.latency_ms', payLatency, [`brand:${brand}`, `method:${paymentMethod}`]);
    });

    brandOrders[brand].push(order);
    brandMetrics[brand].totalOrders++;
    brandMetrics[brand].totalRevenue += order.total;

    span.setTag('order.total', order.total);
    span.setTag('channel',     channel);
    span.setTag('slow_pos',    slowPos);

    const sTags = storeTags(store);
    logger.info('order.created', {
      brand, team: b.team, orderId: order.id, item: order.item,
      total: order.total, channel, slow_pos: slowPos, processing_ms: delayMs,
      payment_method: paymentMethod,
      ...(store && { region: store.region, state: store.state, city: store.city, store_id: store.store_id }),
    });

    dogstatsd.increment('orders.created',      1,           [`brand:${brand}`, `team:${b.team}`, `channel:${channel}`, ...sTags]);
    dogstatsd.increment('orders.revenue',      order.total, [`brand:${brand}`, `team:${b.team}`, ...sTags]);
    dogstatsd.histogram('orders.value',        order.total, [`brand:${brand}`, `team:${b.team}`, ...sTags]);
    dogstatsd.histogram('pos.processing_time', delayMs,     [`brand:${brand}`, `team:${b.team}`, `slow_pos:${slowPos}`, ...sTags]);

    res.status(201).json({ ...order, ...(store && { store_id: store.store_id, city: store.city, state: store.state, region: store.region }) });
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
  const chaos    = FLAGS[`${brand}-chaos`]?.enabled;
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
    span.setTag('chaos',    chaos);

    if (chaos) {
      brandMetrics[brand].errors++;
      span.setTag('error', true);
      dogstatsd.increment('loyalty.errors', 1, [`brand:${brand}`, `team:${b.team}`, 'error_type:chaos']);
      logger.error('loyalty.chaos', { brand, team: b.team, userId, message: 'Loyalty unavailable — chaos mode active' });
      return res.status(503).json({ error: 'Service unavailable — critical incident in progress', chaos: true });
    }

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

  const b     = BRANDS[brand];
  const surge = evalFlag('delivery-surge');
  const chaos = FLAGS[`${brand}-chaos`]?.enabled;
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
    span.setTag('chaos',  chaos);

    if (chaos) {
      span.setTag('error', true);
      logger.error('delivery.chaos', { brand, team: b.team, message: 'Delivery unavailable — chaos mode active' });
      return res.status(503).json({ error: 'Delivery service unavailable — critical incident in progress', chaos: true });
    }

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

  // Persist flag state to DB
  dbQuery(
    'INSERT INTO feature_flags (key, enabled, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET enabled=$2, updated_at=NOW()',
    [name, newValue]
  );

  // Chaos cascade: flip pos-outage + slow-pos together, and burst metrics to fire monitors immediately
  if (name.endsWith('-chaos')) {
    const brand = name.replace('-chaos', '');
    if (FLAGS[`${brand}-pos-outage`]) FLAGS[`${brand}-pos-outage`].enabled = newValue;
    if (FLAGS[`${brand}-slow-pos`])   FLAGS[`${brand}-slow-pos`].enabled   = newValue;
    // Persist cascaded flags so they survive restarts
    dbQuery('INSERT INTO feature_flags (key,enabled,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET enabled=$2,updated_at=NOW()', [`${brand}-pos-outage`, newValue]);
    dbQuery('INSERT INTO feature_flags (key,enabled,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET enabled=$2,updated_at=NOW()', [`${brand}-slow-pos`, newValue]);
    if (BRANDS[brand]) {
      const b = BRANDS[brand];
      if (newValue) {
        const brandStores = LOCATIONS[brand] || [];
        for (let i = 0; i < 12; i++) {
          const cs = brandStores.length ? brandStores[Math.floor(Math.random() * brandStores.length)] : null;
          const csTags = storeTags(cs);
          dogstatsd.increment('pos.errors',    1, [`brand:${brand}`, `team:${b.team}`, 'error_type:chaos', ...csTags]);
          dogstatsd.increment('http.requests', 1, [`status:500`, `method:POST`, `brand:${brand}`, `team:${b.team}`, ...csTags]);
          // High latency values so p95 latency monitor fires (chaos returns 503 before the normal histogram runs)
          dogstatsd.histogram('pos.processing_time', 3000 + Math.floor(Math.random() * 3000), [`brand:${brand}`, `team:${b.team}`, 'slow_pos:true', 'error_type:chaos', ...csTags]);
        }
        logger.error('chaos.activated', { brand, team: b.team, message: 'Full chaos mode activated — all services degraded' });
        // Fire slow queries to surface in DBM during chaos
        if (dbReady) {
          dbQuery(`SELECT pg_sleep(1.5), count(*), sum(orders), sum(revenue) FROM brand_metrics WHERE brand = $1`, [brand]).catch(() => {});
          dbQuery(`SELECT b.brand, count(*) FROM brand_metrics b JOIN feature_flags f ON b.brand = f.key WHERE b.ts > NOW() - INTERVAL '1 hour' GROUP BY b.brand ORDER BY count(*) DESC`, []).catch(() => {});
        }
      } else {
        logger.info('chaos.cleared', { brand, team: b.team, message: 'Chaos mode cleared — services restored' });
      }
    }
  }

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

// ── Reset all flags atomically ────────────────────────────
app.post('/api/flags/reset', (req, res) => {
  for (const name of Object.keys(FLAGS)) {
    FLAGS[name].enabled = false;
    dbQuery(
      'INSERT INTO feature_flags (key,enabled,updated_at) VALUES ($1,false,NOW()) ON CONFLICT (key) DO UPDATE SET enabled=false,updated_at=NOW()',
      [name]
    );
  }
  logger.info('platform.all_clear', { message: 'All incident flags reset to disabled' });
  dogstatsd.increment('feature_flag.all_clear', 1);
  res.json({ ok: true, cleared: Object.keys(FLAGS).length });
});

// ── Monitor status proxy (all monitors tagged to this service) ───────────────
app.get('/api/monitors', async (req, res) => {
  const apiKey = process.env.DD_API_KEY;
  const appKey = process.env.DD_APP_KEY;
  const site   = process.env.DD_SITE || 'datadoghq.com';

  if (!apiKey || !appKey) {
    return res.json({ monitors: [], total: 0, error: 'DD_APP_KEY not configured' });
  }

  try {
    const qs = new URLSearchParams({
      page_size:    '200',
      monitor_tags: 'service:inspire-brands-platform',
    });

    const r = await fetch(`https://api.${site}/api/v1/monitor?${qs}`, {
      headers: {
        'DD-API-KEY':         apiKey,
        'DD-APPLICATION-KEY': appKey,
      },
    });

    if (!r.ok) {
      return res.json({ monitors: [], total: 0, error: `Datadog API returned ${r.status}` });
    }

    const raw  = await r.json();
    const list = Array.isArray(raw) ? raw : [];

    const STATE_ORDER = { Alert: 0, Warn: 1, 'No Data': 2, Unknown: 3, OK: 4, Ignored: 5 };

    const monitors = list
      .filter(m => m.type !== 'synthetics alert')
      .map(m => {
        const brandTag = (m.tags || []).find(t => t.startsWith('brand:'));
        const teamTag  = (m.tags || []).find(t => t.startsWith('team:'));
        return {
          id:       m.id,
          name:     m.name,
          state:    m.overall_state || 'Unknown',
          priority: m.priority || 3,
          type:     m.type,
          brand:    brandTag ? brandTag.replace('brand:', '') : null,
          team:     teamTag  ? teamTag.replace('team:', '')   : null,
          url:      `https://app.${site}/monitors/${m.id}`,
        };
      })
      .sort((a, b) => {
        const sa = STATE_ORDER[a.state] ?? 3;
        const sb = STATE_ORDER[b.state] ?? 3;
        return sa !== sb ? sa - sb : (a.priority || 5) - (b.priority || 5);
      });

    const summary = { ok: 0, alert: 0, warn: 0, noData: 0, other: 0 };
    monitors.forEach(m => {
      if      (m.state === 'OK')      summary.ok++;
      else if (m.state === 'Alert')   summary.alert++;
      else if (m.state === 'Warn')    summary.warn++;
      else if (m.state === 'No Data') summary.noData++;
      else                             summary.other++;
    });

    logger.info('monitors.fetched', { total: monitors.length, ...summary });
    res.json({ monitors, total: monitors.length, summary, timestamp: new Date().toISOString() });
  } catch (e) {
    logger.error('monitors.proxy_error', { error: e.message });
    res.json({ monitors: [], total: 0, error: e.message });
  }
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

// ── LLM evaluation helpers ────────────────────────────────────────────────────
function scoreResponse(message, response) {
  const q = message.toLowerCase();
  const r = response.toLowerCase();
  const relevant   = BRAND_KEYS.some(k => r.includes(k)) || r.includes('datadog') || r.includes('platform');
  const specific   = r.length > 200;
  const hasNumbers = /\d+/.test(r);
  return {
    relevance:    relevant ? +(0.78 + Math.random() * 0.20).toFixed(2) : +(0.40 + Math.random() * 0.30).toFixed(2),
    faithfulness: specific  ? +(0.80 + Math.random() * 0.18).toFixed(2) : +(0.55 + Math.random() * 0.25).toFixed(2),
    quality:      hasNumbers ? +(3.8  + Math.random() * 1.2).toFixed(1)  : +(2.5  + Math.random() * 1.5).toFixed(1),
  };
}

// Rotate between two model variants so Datadog shows an A/B experiment
let _chatCallCount = 0;
function pickModel() {
  _chatCallCount++;
  return _chatCallCount % 2 === 0
    ? { modelName: CUSTOMER.servicePrefix + '-assistant-v2', modelProvider: CUSTOMER.servicePrefix + '-internal' }
    : { modelName: CUSTOMER.servicePrefix + '-assistant-v1', modelProvider: CUSTOMER.servicePrefix + '-internal' };
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

        const response = await client.messages.create({
          model: 'claude-sonnet-4-6', max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: message }],
        });

        assistantMessage = response.content[0].text;
        usage            = response.usage;

        LLMObs.annotate(null, {
          inputData:  [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
          outputData: [{ role: 'assistant', content: assistantMessage }],
          metadata: { brand: brandTag, sessionId, mock: false },
          metrics: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.input_tokens + usage.output_tokens },
        });
      });

    } else {
      // ── Mock path — real LLMObs spans with full content ──
      const latency = 350 + Math.random() * 700;
      await new Promise(r => setTimeout(r, latency));
      assistantMessage = mockResponse(message);
      usage = {
        input_tokens:  Math.floor(systemPrompt.length / 4) + Math.floor(message.length / 4),
        output_tokens: Math.floor(assistantMessage.length / 4),
      };

      if (LLMObs && typeof LLMObs.trace === 'function') {
        const model  = pickModel();
        const scores = scoreResponse(message, assistantMessage);

        await LLMObs.trace({
          kind: 'llm', name: 'platform_chat',
          modelName: model.modelName, modelProvider: model.modelProvider,
          sessionId, mlApp: CUSTOMER.mlApp,
        }, async (span) => {
          span.setTag('brand', brandTag);
          span.setTag('model_variant', model.modelName);
          span.setTag('latency_ms', Math.round(latency));

          LLMObs.annotate(null, {
            inputData:  [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
            outputData: [{ role: 'assistant', content: assistantMessage }],
            metadata: { brand: brandTag, sessionId, mock: true, model_variant: model.modelName },
            metrics: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.input_tokens + usage.output_tokens },
          });

          // Submit evaluations inline while span is still active
          if (typeof LLMObs.submitEvaluation === 'function') {
            try {
              const ts = Date.now();
              LLMObs.submitEvaluation(span, { label: 'relevance',    metricType: 'score', value: scores.relevance,    timestampMs: ts });
              LLMObs.submitEvaluation(span, { label: 'faithfulness', metricType: 'score', value: scores.faithfulness, timestampMs: ts });
              LLMObs.submitEvaluation(span, { label: 'quality',      metricType: 'score', value: scores.quality,      timestampMs: ts });
            } catch (_) {}
          }
        });
      }
    }

    dogstatsd.increment('llm.requests',      1, [`brand:${brandTag}`, `app:${CUSTOMER.mlApp}`]);
    dogstatsd.histogram('llm.input_tokens',  usage.input_tokens,  [`brand:${brandTag}`]);
    dogstatsd.histogram('llm.output_tokens', usage.output_tokens, [`brand:${brandTag}`]);

    logger.info('llm.chat_completion', {
      brand: brandTag, sessionId, mock: !(ANTHROPIC_KEY && Anthropic),
      input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
    });

    // Persist chat session turns to DB
    const modelName = (ANTHROPIC_KEY && Anthropic) ? 'claude-sonnet-4-6' : undefined;
    dbQuery(
      'INSERT INTO chat_sessions (session_id, brand, role, content, tokens) VALUES ($1, $2, $3, $4, $5)',
      [sessionId, brandTag, 'user', message.slice(0, 4000), usage.input_tokens]
    );
    dbQuery(
      'INSERT INTO chat_sessions (session_id, brand, role, content, tokens, model) VALUES ($1, $2, $3, $4, $5, $6)',
      [sessionId, brandTag, 'assistant', assistantMessage.slice(0, 4000), usage.output_tokens, modelName || null]
    );

    res.json({ message: assistantMessage, usage, sessionId });

  } catch (e) {
    logger.error('llm.chat_error', { error: e.message, brand: brandTag, sessionId });
    res.status(500).json({ error: 'Chat completion failed', details: e.message });
  }
});

// ── LLM dataset seeder ────────────────────────────────────────────────────────
// POST /api/llm/seed — fires a rich set of brand-specific conversations to
// populate LLM Observability with realistic traces, evaluations, and two model
// variants (v1/v2) that can be compared in a Datadog Experiment.
app.post('/api/llm/seed', async (req, res) => {
  const conversations = [
    // Arby's
    { brand: 'arbys',   message: "What's the best sandwich at Arby's right now?" },
    { brand: 'arbys',   message: "Is the Arby's drive-thru in Chicago still having POS issues?" },
    { brand: 'arbys',   message: "What monitor fires when Arby's error rate spikes?" },
    { brand: 'arbys',   message: "How do I escalate a Roast Beef supply chain alert to the ops team?" },
    // Buffalo Wild Wings
    { brand: 'bww',     message: "Which BWW locations are showing slow POS response times?" },
    { brand: 'bww',     message: "How does the Wing Tuesday promotion affect order volume metrics?" },
    { brand: 'bww',     message: "Explain the BWW delivery SLO and what triggers a breach." },
    { brand: 'bww',     message: "What's the p95 latency threshold for Buffalo Wild Wings POS?" },
    // Sonic
    { brand: 'sonic',   message: "Why is Sonic Drive-In showing anomalous order volume?" },
    { brand: 'sonic',   message: "How does the carhop channel differ from drive-thru in the APM service map?" },
    { brand: 'sonic',   message: "What's the current Sonic loyalty program lookup failure rate?" },
    { brand: 'sonic',   message: "Explain Sonic's happy hour impact on real-time metrics." },
    // Dunkin'
    { brand: 'dunkin',  message: "How does mobile-order volume compare to drive-thru at Dunkin'?" },
    { brand: 'dunkin',  message: "What team owns the Dunkin' loyalty service?" },
    { brand: 'dunkin',  message: "Is there a monitor for Dunkin' cold brew inventory lag?" },
    { brand: 'dunkin',  message: "How are Dunkin' morning rush metrics tracked in Datadog?" },
    // Baskin-Robbins
    { brand: 'baskin-robbins', message: "What's the catering order SLO for Baskin-Robbins?" },
    { brand: 'baskin-robbins', message: "How does the Baskin-Robbins ice cream cake delivery route work?" },
    { brand: 'baskin-robbins', message: "Which APM service handles Baskin-Robbins online orders?" },
    // Jimmy John's
    { brand: 'jimmy-johns', message: "How does 'Freaky Fast' delivery get measured in Datadog?" },
    { brand: 'jimmy-johns', message: "What happens when Jimmy John's delivery ETA exceeds 15 minutes?" },
    { brand: 'jimmy-johns', message: "Show me the catering service dependency map for Jimmy John's." },
    // Cross-brand / platform
    { brand: 'platform', message: "Which brand had the most orders in the last hour?" },
    { brand: 'platform', message: "Show me a summary of all active incidents right now." },
    { brand: 'platform', message: "How does the loyalty shared service affect all 6 brands?" },
    { brand: 'platform', message: "Walk me through the full alert → triage → resolve workflow." },
    { brand: 'platform', message: "What is Unified Service Tagging and why does it matter here?" },
    { brand: 'platform', message: "How does LLM Observability work in this demo?" },
    { brand: 'platform', message: "Explain cost attribution across Inspire Brands in Datadog." },
    { brand: 'platform', message: "What's the difference between a P1 and P3 monitor in this setup?" },
  ];

  const results = [];
  for (const conv of conversations) {
    try {
      const resp = await fetch(`http://localhost:${process.env.PORT || 3000}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...conv, sessionId: `seed-${Date.now()}-${Math.random().toString(36).slice(2,7)}` }),
      });
      const data = await resp.json();
      results.push({ brand: conv.brand, ok: true, tokens: data.usage?.input_tokens + data.usage?.output_tokens });
      await new Promise(r => setTimeout(r, 120));
    } catch (e) {
      results.push({ brand: conv.brand, ok: false, error: e.message });
    }
  }

  const ok    = results.filter(r => r.ok).length;
  const total = results.length;
  logger.info('llm.seed_complete', { ok, total });
  res.json({ seeded: ok, total, results });
});

// ── Security demo endpoints (ASM) ────────────────────────
// These endpoints intentionally accept user-controlled input so ASM can detect
// and block common attack patterns (SQLi, XSS, path traversal) in demo scenarios.
app.get('/api/security/scan', async (req, res) => {
  const { q = '', user_id = '' } = req.query;
  const span = tracer.scope().active();
  if (span) {
    span.setTag('security.demo', true);
    span.setTag('usr.id', user_id || 'anonymous');
    span.setTag('http.parameters', JSON.stringify(req.query).slice(0, 200));
  }
  logger.warn('security.scan_request', { query: q, user_id, ip: req.ip, suspicious: q.includes("'") || q.includes('<') });
  dogstatsd.increment('security.scan_requests', 1, ['endpoint:search']);
  // Use query in a parameterized DB lookup so APM traces show the DB call
  const rows = await dbQuery('SELECT brand, count(*) FROM brand_metrics WHERE brand ILIKE $1 GROUP BY brand LIMIT 5', [`%${q.replace(/['";<>]/g, '')}%`]);
  res.json({ results: rows?.rows || [], query: q, user_id, timestamp: new Date().toISOString() });
});

app.post('/api/security/login', async (req, res) => {
  const { username = '', password = '' } = req.body;
  const span = tracer.scope().active();
  if (span) {
    span.setTag('security.demo', true);
    span.setTag('usr.name', username.slice(0, 50));
    span.setTag('http.request.body', JSON.stringify({ username, password: '[REDACTED]' }));
  }
  logger.warn('security.login_attempt', { username, ip: req.ip, suspicious: username.includes("'") || username.includes('OR') });
  dogstatsd.increment('security.login_attempts', 1);
  // Parameterized lookup — WAF fires on the raw request before this runs
  const user = await dbQuery('SELECT brand FROM brand_metrics WHERE brand = $1 LIMIT 1', [username.replace(/['";<>]/g, '').slice(0, 50)]);
  const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
  res.json({ token, username, authenticated: !!(user?.rows?.length), timestamp: new Date().toISOString() });
});

app.get('/api/security/file', (req, res) => {
  const { path: filePath = 'menu.json' } = req.query;
  const span = tracer.scope().active();
  if (span) {
    span.setTag('security.demo', true);
    span.setTag('file.path', filePath.slice(0, 200));
    span.setTag('http.parameters', JSON.stringify(req.query).slice(0, 200));
  }
  logger.warn('security.file_request', { path: filePath, ip: req.ip, suspicious: filePath.includes('..') || filePath.includes('/etc/') });
  dogstatsd.increment('security.file_requests', 1, ['endpoint:file']);
  // Resolve path but serve only from safe content map — WAF fires on traversal pattern in request
  const SAFE = { 'menu.json': 'menu', 'config.json': 'config', 'health.json': 'health' };
  const content = SAFE[filePath] ? `demo:${SAFE[filePath]}` : 'access denied';
  res.json({ file: filePath, content, timestamp: new Date().toISOString() });
});

// ── Error Tracking demo ───────────────────────────────────
// Generates realistic backend errors that surface in Datadog Error Tracking
// grouped by type/fingerprint, with full stack traces and span context.
const ERROR_SCENARIOS = [
  {
    type:    'PaymentGatewayTimeoutError',
    message: 'Payment gateway did not respond within 30000ms',
    stack:   'PaymentGatewayTimeoutError: Payment gateway did not respond within 30000ms\n    at PaymentClient.charge (/app/services/payment.js:142:13)\n    at processOrder (/app/services/pos.js:89:22)',
    tags:    { 'error.type': 'PaymentGatewayTimeoutError', component: 'payment-gateway', http_status: 504 },
  },
  {
    type:    'LoyaltyServiceConnectionError',
    message: 'ECONNREFUSED connecting to loyalty-api:8443',
    stack:   'LoyaltyServiceConnectionError: ECONNREFUSED connecting to loyalty-api:8443\n    at LoyaltyClient.lookup (/app/services/loyalty.js:77:9)\n    at enrichOrder (/app/services/pos.js:201:18)',
    tags:    { 'error.type': 'LoyaltyServiceConnectionError', component: 'loyalty-service', http_status: 503 },
  },
  {
    type:    'MenuSyncStaleDataError',
    message: "Cannot read properties of undefined (reading 'price') — menu cache is stale",
    stack:   "MenuSyncStaleDataError: Cannot read properties of undefined (reading 'price')\n    at buildOrderTotal (/app/services/menu.js:55:38)\n    at POST /api/:brand/orders (/app/server.js:312:14)",
    tags:    { 'error.type': 'MenuSyncStaleDataError', component: 'menu-cache', http_status: 500 },
  },
  {
    type:    'InventoryReservationConflict',
    message: 'Optimistic lock conflict: inventory row modified by concurrent request',
    stack:   'InventoryReservationConflict: Optimistic lock conflict\n    at InventoryClient.reserve (/app/services/inventory.js:188:11)\n    at processOrder (/app/services/pos.js:134:30)',
    tags:    { 'error.type': 'InventoryReservationConflict', component: 'inventory-service', http_status: 409 },
  },
];

app.post('/api/error-demo/:brand', async (req, res) => {
  const { brand } = req.params;
  const b = BRANDS[brand];
  if (!b) return res.status(404).json({ error: 'Unknown brand' });

  const scenario = ERROR_SCENARIOS[Math.floor(Math.random() * ERROR_SCENARIOS.length)];
  const err = new Error(scenario.message);
  err.name  = scenario.type;
  err.stack = scenario.stack;

  return tracer.trace('pos.create_order', {
    service:  `${CUSTOMER.servicePrefix}-${brand}-pos`,
    resource: `POST /api/${brand}/orders`,
    type:     'web',
  }, async (span) => {
    span.setTag('brand', brand);
    span.setTag('team',  b.team);
    span.setTag('error', true);
    Object.entries(scenario.tags).forEach(([k, v]) => span.setTag(k, v));
    span.setTag('error.msg',   err.message);
    span.setTag('error.stack', err.stack);
    span.setTag('error.type',  err.name);

    logger.error('pos.order_failed', {
      brand, team: b.team,
      error:      err.message,
      error_type: err.name,
      component:  scenario.tags.component,
    });
    dogstatsd.increment('pos.errors', 1, [
      `brand:${brand}`, `team:${b.team}`,
      `error_type:${scenario.type.toLowerCase()}`,
      'source:error_demo',
    ]);

    await new Promise(r => setTimeout(r, 120));
    res.status(500).json({
      error:      err.message,
      error_type: err.name,
      brand,
      component:  scenario.tags.component,
      dd_trace:   'https://app.datadoghq.com/apm/traces',
      dd_errors:  'https://app.datadoghq.com/error-tracking',
    });
  });
});

// ── Sensitive Data Scanner demo ───────────────────────────
// Emits structured log events containing realistic fake PII so SDS scanning
// rules can detect and redact credit cards, SSNs, and emails in the log pipeline.
const FAKE_PII_SCENARIOS = [
  {
    event:       'payment.processed',
    customer_id: 'cust_8821947302',
    card_number: '4532-0152-8347-1903',   // fake Visa, fails Luhn
    card_last4:  '1903',
    name:        'Jennifer Caldwell',
    email:       'jcaldwell@example-inspire.com',
    ssn_hint:    '***-**-4721',
    amount:      24.99,
    brand:       null,
  },
  {
    event:       'loyalty.enrollment',
    customer_id: 'cust_4409183726',
    card_number: '5425-2334-3010-9903',   // fake MC, fails Luhn
    card_last4:  '9903',
    name:        'Marcus Thompson',
    email:       'mthompson@gmail-example.com',
    ssn:         '123-45-6789',            // obviously fake SSN
    amount:      0,
    brand:       null,
  },
];

app.post('/api/sds-demo', (req, res) => {
  const { brand = 'arbys' } = req.body;
  const b    = BRANDS[brand] || BRANDS['arbys'];
  const pii  = FAKE_PII_SCENARIOS[Math.floor(Math.random() * FAKE_PII_SCENARIOS.length)];
  const payload = { ...pii, brand, team: b.team, timestamp: new Date().toISOString() };

  logger.warn('customer.payment_record', payload);
  dogstatsd.increment('sds.demo_events', 1, [`brand:${brand}`, 'event_type:pii_exposure_demo']);

  res.json({
    ok:      true,
    message: 'PII log event emitted — check Sensitive Data Scanner in Datadog',
    event:   pii.event,
    dd_sds:  'https://app.datadoghq.com/organization-settings/sensitive-data-scanner',
    dd_logs: `https://app.datadoghq.com/logs?query=service:${CUSTOMER.platform}+%40brand:${brand}`,
  });
});

// ── Deployment event + 60s burst ─────────────────────────
let deployBurstUntil = 0;

app.post('/api/deploy', async (req, res) => {
  const apiKey = process.env.DD_API_KEY;
  const appKey = process.env.DD_APP_KEY;
  const site   = process.env.DD_SITE || 'datadoghq.com';
  const { version = '2.0.0' } = req.body;

  deployBurstUntil = Date.now() + 60000;

  if (apiKey && appKey) {
    fetch(`https://api.${site}/api/v1/events`, {
      method:  'POST',
      headers: { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:            `Deployment: ${CUSTOMER.platform} v${version}`,
        text:             `%%% \nNew version **v${version}** deployed to \`${process.env.DD_ENV || 'local'}\`\n\n**Services restarting:** ${1 + BRAND_KEYS.length * 3}\n\n**Team:** ${CUSTOMER.platformTeamName}\n %%%`,
        tags:             [`env:${process.env.DD_ENV || 'local'}`, `service:${CUSTOMER.platform}`, `version:${version}`],
        alert_type:       'info',
        source_type_name: 'My Apps',
      }),
    }).catch(() => {});
  }

  dogstatsd.event(`Deployment: v${version}`, `${CUSTOMER.platform} v${version} deployed`, {
    alertType: 'info',
    tags:      [`version:${version}`, `env:${process.env.DD_ENV || 'local'}`],
  });
  logger.info('deployment.started', { version, env: process.env.DD_ENV, burst_ms: 60000 });
  res.json({ ok: true, version, burstDurationMs: 60000 });
});

// ── DBM helpers ──────────────────────────────────────────
async function fetchDDSlowQueries(apiKey, appKey, site) {
  const now  = Math.floor(Date.now() / 1000);
  const from = now - 3600;
  const base = `https://api.${site}/api/v1/query`;
  const hdrs = { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey };
  const tQ = encodeURIComponent('sum:postgresql.queries.time{*}by{query_signature}');
  const cQ = encodeURIComponent('sum:postgresql.queries.count{*}by{query_signature}');
  const [tR, cR] = await Promise.all([
    fetch(`${base}?from=${from}&to=${now}&query=${tQ}`, { headers: hdrs }),
    fetch(`${base}?from=${from}&to=${now}&query=${cQ}`, { headers: hdrs }),
  ]);
  if (!tR.ok) return null;
  const tData = await tR.json();
  const cData = cR.ok ? await cR.json() : { series: [] };
  const sigMap = {};
  for (const s of (tData.series || [])) {
    const sig = (s.tag_set || []).find(t => t.startsWith('query_signature:'))?.slice('query_signature:'.length);
    if (!sig) continue;
    sigMap[sig] = { totalTime: (s.pointlist || []).reduce((a, [, v]) => a + (v || 0), 0), calls: 0 };
  }
  for (const s of (cData.series || [])) {
    const sig = (s.tag_set || []).find(t => t.startsWith('query_signature:'))?.slice('query_signature:'.length);
    if (sig && sigMap[sig]) sigMap[sig].calls = (s.pointlist || []).reduce((a, [, v]) => a + (v || 0), 0);
  }
  const rows = Object.entries(sigMap)
    .filter(([, d]) => d.calls > 0)
    .map(([sig, { totalTime, calls }]) => ({
      query:  sig,
      calls:  Math.round(calls),
      meanMs: (totalTime / calls / 1_000_000).toFixed(3), // ns → ms
      fromDD: true,
      ddLink: `https://app.datadoghq.com/databases/queries?dbms=postgres&query_signature=${sig}`,
    }))
    .sort((a, b) => parseFloat(b.meanMs) - parseFloat(a.meanMs))
    .slice(0, 5);
  return rows.length ? rows : null;
}

// ── DBM stats ────────────────────────────────────────────
app.get('/api/dbm/stats', async (req, res) => {
  if (!dbReady) return res.json({ ready: false });
  try {
    const [activity, tbl] = await Promise.all([
      dbQuery(`SELECT
        count(*) AS connections,
        count(*) FILTER (WHERE state='active') AS active,
        count(*) FILTER (WHERE state='active' AND now()-query_start > interval '1 second') AS slow,
        max(EXTRACT(epoch FROM (now()-query_start)) * 1000) FILTER (WHERE state='active') AS max_ms
        FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`),
      dbQuery(`SELECT count(*) AS total_rows, count(DISTINCT brand) AS brands,
               max(ts) AS last_ts FROM brand_metrics`),
    ]);
    const a = activity?.rows?.[0] || {};
    const t = tbl?.rows?.[0]      || {};

    // Try Datadog first; fall back to local pg_stat_statements
    const apiKey = process.env.DD_API_KEY;
    const appKey = process.env.DD_APP_KEY;
    const site   = process.env.DD_SITE || 'datadoghq.com';
    let topSlowQueries = null;
    let slowFromDD = false;
    if (apiKey && appKey) {
      try { topSlowQueries = await fetchDDSlowQueries(apiKey, appKey, site); if (topSlowQueries) slowFromDD = true; } catch {}
    }
    if (!topSlowQueries) {
      const slowLog = await dbQuery(`SELECT query, calls, mean_exec_time, max_exec_time
        FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname=current_database())
        ORDER BY mean_exec_time DESC LIMIT 5`);
      topSlowQueries = (slowLog?.rows || []).map(r => ({
        query:  r.query.slice(0, 80),
        calls:  parseInt(r.calls),
        meanMs: parseFloat(r.mean_exec_time).toFixed(1),
        maxMs:  parseFloat(r.max_exec_time).toFixed(1),
        fromDD: false,
      }));
    }

    res.json({
      ready:         true,
      connections:   parseInt(a.connections) || 0,
      activeQueries: parseInt(a.active)      || 0,
      slowNow:       parseInt(a.slow)        || 0,
      maxLatencyMs:  parseFloat(a.max_ms)    || 0,
      totalRows:     parseInt(t.total_rows)  || 0,
      brands:        parseInt(t.brands)      || 0,
      lastWrite:     t.last_ts              || null,
      topSlowQueries,
      slowFromDD,
      dbmUrl: `https://app.datadoghq.com/databases/queries?dbms=postgres`,
    });
  } catch (e) {
    res.json({ ready: true, error: e.message, connections: 0, activeQueries: 0, slowNow: 0 });
  }
});

// ── SLO status (KPI source) ───────────────────────────────
// Cache results for 60s — each refresh fans out N parallel history calls
let _sloCache = null;
let _sloCacheAt = 0;

app.get('/api/datadog/slos', async (req, res) => {
  const apiKey = process.env.DD_API_KEY;
  const appKey = process.env.DD_APP_KEY;
  const site   = process.env.DD_SITE || 'datadoghq.com';
  if (!apiKey || !appKey) return res.json({ slos: [], total: 0, ok: 0, breached: 0, warn: 0 });

  if (_sloCache && Date.now() - _sloCacheAt < 60_000) return res.json(_sloCache);

  try {
    const hdrs = { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey };

    // Fetch all SLOs — tag filter param doesn't work server-side, filter client-side
    const listResp = await fetch(`https://api.${site}/api/v1/slo?limit=250`, { headers: hdrs });
    if (!listResp.ok) return res.json({ slos: [], total: 0, ok: 0, breached: 0, warn: 0 });
    const listData  = await listResp.json();
    const inspireSlos = (listData.data || []).filter(s =>
      (s.tags || []).includes(`service:${CUSTOMER.platform}`)
    );
    if (!inspireSlos.length) return res.json({ slos: [], total: 0, ok: 0, breached: 0, warn: 0 });

    // Fan out parallel history calls to get actual state per SLO
    const now  = Math.floor(Date.now() / 1000);
    const from = now - 7 * 86400;
    const slos = await Promise.all(inspireSlos.map(async (s) => {
      try {
        const r = await fetch(
          `https://api.${site}/api/v1/slo/${s.id}/history?from_ts=${from}&to_ts=${now}`,
          { headers: hdrs }
        );
        if (!r.ok) return { id: s.id, name: s.name, status: 'No Data' };
        const h     = await r.json();
        const state = h.data?.overall?.state || 'no_data';
        return {
          id:     s.id,
          name:   s.name,
          status: state === 'ok' ? 'OK' : state === 'breached' ? 'Breached' : state === 'warning' ? 'Warning' : 'No Data',
        };
      } catch { return { id: s.id, name: s.name, status: 'No Data' }; }
    }));

    const ok      = slos.filter(s => s.status === 'OK').length;
    const breached = slos.filter(s => s.status === 'Breached').length;
    const warn    = slos.filter(s => s.status === 'Warning').length;
    _sloCache   = { slos, total: slos.length, ok, breached, warn };
    _sloCacheAt = Date.now();
    res.json(_sloCache);
  } catch (e) {
    res.json({ slos: [], total: 0, ok: 0, breached: 0, warn: 0, error: e.message });
  }
});

// ── Datadog metrics summary (KPI source of truth) ────────
app.get('/api/datadog/summary', async (req, res) => {
  const apiKey = process.env.DD_API_KEY;
  const appKey = process.env.DD_APP_KEY;
  const site   = process.env.DD_SITE || 'datadoghq.com';

  if (!apiKey || !appKey) return res.json({ error: 'DD keys not configured', fromDD: false });

  const now  = Math.floor(Date.now() / 1000);
  const from = now - 86400; // last 24 hours

  async function ddMetric(query) {
    try {
      const qs = new URLSearchParams({ from, to: now, query });
      const r  = await fetch(`https://api.${site}/api/v1/query?${qs}`, {
        headers: { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey },
      });
      if (!r.ok) return null;
      const data = await r.json();
      const pts  = data.series?.[0]?.pointlist || [];
      return pts.reduce((s, [, v]) => s + (v || 0), 0);
    } catch { return null; }
  }

  const pfx = CUSTOMER.metricPrefix;
  const [orders, revenue, errors, requests] = await Promise.all([
    ddMetric(`sum:${pfx}.orders.created{*}.as_count()`),
    ddMetric(`sum:${pfx}.orders.revenue{*}.as_count()`),
    ddMetric(`sum:${pfx}.pos.errors{*}.as_count()`),
    ddMetric(`sum:${pfx}.http.requests{*}.as_count()`),
  ]);

  res.json({
    orders:      orders   !== null ? Math.round(orders)          : null,
    revenue:     revenue  !== null ? +revenue.toFixed(2)          : null,
    errors:      errors   !== null ? Math.round(errors)           : null,
    requests:    requests !== null ? Math.round(requests)         : null,
    fromDD:      true,
    windowHours: 24,
  });
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
  if (FLAGS[`${brand}-chaos`]?.enabled) {
    const name = BRANDS[brand].name;
    return res.status(503).send(`<!DOCTYPE html><html><head><title>${name} — Service Unavailable</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0d0000;color:#fff;text-align:center}div{padding:40px}.code{font-size:5rem;font-weight:900;color:#ef4444;line-height:1}.title{font-size:1.4rem;font-weight:700;margin:16px 0 8px;color:#fca5a5}.sub{font-size:.95rem;color:#9ca3af}</style></head><body><div><div class="code">☢ 503</div><div class="title">${name} — Critical Incident</div><div class="sub">All services unavailable. Chaos mode is active.</div></div></body></html>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'brands', 'app.html'));
});

// ── Traffic rate control ──────────────────────────────────
app.get('/api/traffic-rate', (req, res) => {
  res.json({ rate: trafficRate, config: TRAFFIC_RATES[trafficRate] });
});

app.post('/api/traffic-rate/:rate', (req, res) => {
  const { rate } = req.params;
  if (!TRAFFIC_RATES[rate]) return res.status(400).json({ error: `Unknown rate: ${rate}. Use off|low|medium|high` });
  trafficRate = rate;
  logger.info('traffic.rate_changed', { rate, config: TRAFFIC_RATES[rate] });
  res.json({ rate, config: TRAFFIC_RATES[rate] });
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

// ── Background traffic generator ─────────────────────────
// Fires realistic orders, loyalty lookups, and delivery estimates
// across all brands continuously to keep metrics and APM flowing.
let trafficRate = 'medium'; // 'low' | 'medium' | 'high' | 'off'

const TRAFFIC_RATES = {
  off:    { ordersPerBrand: 0, intervalMs: 5000 },
  low:    { ordersPerBrand: 1, intervalMs: 8000  },  // ~7/brand/min
  medium: { ordersPerBrand: 3, intervalMs: 5000  },  // ~36/brand/min
  high:   { ordersPerBrand: 8, intervalMs: 3000  },  // ~160/brand/min
};

const BG_PAYMENT_METHODS = ['credit_card', 'debit_card', 'apple_pay', 'google_pay'];

async function fireBackgroundOrder(brand) {
  const b = BRANDS[brand];
  if (!b) return;

  const outage = FLAGS[`${brand}-pos-outage`]?.enabled;
  const slow   = FLAGS[`${brand}-slow-pos`]?.enabled;
  const store  = pickStore(brand);
  const sTags  = storeTags(store);

  if (outage) {
    brandMetrics[brand].errors++;
    dogstatsd.increment('pos.errors', 1, [`brand:${brand}`, `team:${b.team}`, 'error_type:outage', 'source:background', ...sTags]);
    return;
  }

  return tracer.trace('pos.create_order', {
    service:  `${CUSTOMER.servicePrefix}-${brand}-pos`,
    resource: `worker/${brand}/order`,
    type:     'worker',
  }, async (span) => {
    span.setTag('brand',    brand);
    span.setTag('team',     b.team);
    span.setTag('source',   'background');
    span.setTag('slow_pos', slow);
    if (store) {
      span.setTag('region',   store.region);
      span.setTag('state',    store.state);
      span.setTag('city',     store.city);
      span.setTag('store_id', store.store_id);
    }

    // 1. Cache lookup for menu
    await tracer.trace('cache.menu_lookup', {
      service:  `${CUSTOMER.servicePrefix}-cache`,
      resource: `GET menu:${brand}`,
      type:     'cache',
    }, async (cacheSpan) => {
      const hit = Math.random() > 0.12;
      cacheSpan.setTag('cache.hit', hit);
      cacheSpan.setTag('component', 'redis');
      cacheSpan.setTag('brand', brand);
      dogstatsd.increment('cache.requests', 1, [`brand:${brand}`, `cache:menu`, `hit:${hit}`]);
      await new Promise(r => setTimeout(r, hit ? 1 : 9));
    });

    const channel  = b.channels[Math.floor(Math.random() * b.channels.length)];
    const item     = b.menu[Math.floor(Math.random() * b.menu.length)];
    const quantity = Math.random() < 0.2 ? 2 : 1;
    const baseMs   = Math.floor(Math.random() * 300) + 50;
    const delayMs  = slow ? baseMs * 3 : baseMs;

    await new Promise(r => setTimeout(r, delayMs));

    const order = {
      id:           uuidv4(),
      brand,
      item:         item.name,
      quantity,
      total:        +(item.price * quantity).toFixed(2),
      channel,
      status:       'confirmed',
      processingMs: delayMs,
    };

    span.setTag('order.total', order.total);
    span.setTag('channel',     channel);

    // 2. Payment authorization
    const paymentMethod = BG_PAYMENT_METHODS[Math.floor(Math.random() * BG_PAYMENT_METHODS.length)];
    await tracer.trace('payment.process', {
      service:  `${CUSTOMER.servicePrefix}-payments`,
      resource: 'POST /v1/payment_intents',
      type:     'http',
    }, async (paySpan) => {
      paySpan.setTag('payment.amount',   order.total);
      paySpan.setTag('payment.currency', 'usd');
      paySpan.setTag('payment.method',   paymentMethod);
      paySpan.setTag('brand', brand);
      const payLatency = 50 + Math.floor(Math.random() * 150);
      await new Promise(r => setTimeout(r, payLatency));
      const declined = Math.random() < 0.02;
      if (declined) {
        paySpan.setTag('error', true);
        paySpan.setTag('payment.status', 'declined');
        dogstatsd.increment('payment.declined', 1, [`brand:${brand}`, `method:${paymentMethod}`]);
      } else {
        paySpan.setTag('payment.status', 'authorized');
        dogstatsd.increment('payment.authorized', 1, [`brand:${brand}`, `method:${paymentMethod}`]);
      }
      dogstatsd.histogram('payment.latency_ms', payLatency, [`brand:${brand}`, `method:${paymentMethod}`]);
    });

    // 3. Write order to DB (surfaces in DBM query patterns)
    if (dbReady) {
      await tracer.trace('db.insert_order', {
        service:  `${CUSTOMER.servicePrefix}-${brand}-pos`,
        resource: 'INSERT brand_metrics',
        type:     'sql',
      }, async (dbSpan) => {
        dbSpan.setTag('db.type',     'postgresql');
        dbSpan.setTag('db.instance', process.env.PGDATABASE || 'inspire_brands');
        dbSpan.setTag('brand', brand);
        await dbQuery(
          'INSERT INTO brand_metrics (brand, orders, revenue, errors) VALUES ($1, 1, $2, 0)',
          [brand, order.total]
        );
      });
      // Keep delta flush in sync so it doesn't double-count
      _lastFlushed[brand].totalOrders++;
      _lastFlushed[brand].totalRevenue += order.total;
    }

    brandOrders[brand].push(order);
    brandMetrics[brand].totalOrders++;
    brandMetrics[brand].totalRevenue += order.total;

    dogstatsd.increment('orders.created',      1,           [`brand:${brand}`, `team:${b.team}`, `channel:${channel}`, 'source:background', ...sTags]);
    dogstatsd.increment('orders.revenue',      order.total, [`brand:${brand}`, `team:${b.team}`, ...sTags]);
    dogstatsd.histogram('orders.value',        order.total, [`brand:${brand}`, `team:${b.team}`, ...sTags]);
    dogstatsd.histogram('pos.processing_time', delayMs,     [`brand:${brand}`, `team:${b.team}`, `slow_pos:${slow}`, ...sTags]);

    // 4. Loyalty lookup (~40% of orders)
    if (Math.random() < 0.4 && !FLAGS[`${brand}-chaos`]?.enabled) {
      const degraded = FLAGS['loyalty-degraded']?.enabled;
      brandMetrics[brand].loyaltyLookups++;
      await tracer.trace('loyalty.member_lookup', {
        service:  `${CUSTOMER.servicePrefix}-${brand}-loyalty`,
        resource: `GET loyalty/${brand}/member`,
        type:     'http',
      }, async (loySpan) => {
        loySpan.setTag('brand',    brand);
        loySpan.setTag('team',     b.team);
        loySpan.setTag('degraded', degraded);
        if (store) {
          loySpan.setTag('region',   store.region);
          loySpan.setTag('state',    store.state);
          loySpan.setTag('city',     store.city);
          loySpan.setTag('store_id', store.store_id);
        }
        if (degraded && Math.random() < 0.4) {
          loySpan.setTag('error', true);
          dogstatsd.increment('loyalty.errors', 1, [`brand:${brand}`, `team:${b.team}`, 'source:background', ...sTags]);
        } else {
          const points  = Math.floor(Math.random() * 5000) + 100;
          const latency = degraded ? Math.random() * 2000 + 400 : Math.random() * 200 + 20;
          await new Promise(r => setTimeout(r, latency));
          loySpan.setTag('loyalty.points', points);
          dogstatsd.histogram('loyalty.lookup_latency', latency, [`brand:${brand}`, `team:${b.team}`, ...sTags]);
          dogstatsd.gauge('loyalty.member_points',       points,  [`brand:${brand}`, `team:${b.team}`, ...sTags]);
        }
      });
    }
  });
}

function scheduleBackgroundTraffic() {
  const { ordersPerBrand, intervalMs } = TRAFFIC_RATES[trafficRate];
  if (ordersPerBrand === 0) return setTimeout(scheduleBackgroundTraffic, 2000);

  const fires = [];
  for (const brand of BRAND_KEYS) {
    const count = ordersPerBrand + Math.floor(Math.random() * 2); // slight jitter
    for (let i = 0; i < count; i++) {
      fires.push(fireBackgroundOrder(brand));
    }
  }
  Promise.allSettled(fires).then(() => setTimeout(scheduleBackgroundTraffic, intervalMs));
}

async function startup() {
  try {
    const client = await db.connect();
    client.release();
    dbReady = true;
    console.log('✓ PostgreSQL connected (DBM enabled)');
    await restoreState();
    setInterval(flushMetricsToDB, 30000);
  } catch (e) {
    console.warn('⚠  PostgreSQL unavailable — running in-memory only:', e.message);
  }

  app.listen(PORT, () => {
    logger.info(`${CUSTOMER.platform} started`, {
      port:   PORT,
      env:    process.env.DD_ENV || 'local',
      brands: BRAND_KEYS.length,
      teams:  [...new Set(BRAND_KEYS.map(b => BRANDS[b].team))],
      db:     dbReady ? 'postgres' : 'in-memory',
    });
    dogstatsd.increment('platform.started');
    setTimeout(scheduleBackgroundTraffic, 3000);
  });
}
startup();
