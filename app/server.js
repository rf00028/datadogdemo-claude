// dd-trace MUST be initialized before any other requires
const tracer = require('dd-trace').init({
  service: 'inspire-brands-platform',
  env: process.env.DD_ENV || 'local',
  version: process.env.DD_VERSION || '1.0.0',
  logInjection: true,
  runtimeMetrics: true,
  profiling: false,
});

const { LLMObs } = require('dd-trace');

const express        = require('express');
const path           = require('path');
const winston        = require('winston');
const DatadogWinston = require('datadog-winston');
const StatsD         = require('hot-shots');
const { v4: uuidv4 } = require('uuid');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
let   Anthropic     = null;

// Always enable LLMObs — mock path still emits real spans when no API key
LLMObs.enable({ mlApp: 'inspire-brands-assistant', agentlessEnabled: false });

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
    hostname: 'inspire-demo-host',
    service:  'inspire-brands-platform',
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
  prefix:     'inspire.',
  globalTags: [`env:${process.env.DD_ENV || 'local'}`, 'service:inspire-brands-platform'],
  errorHandler: (err) => logger.warn('StatsD error', { error: err.message }),
});

// ── Brand Configuration ───────────────────────────────────
const BRANDS = {
  arbys: {
    name: "Arby's",
    color: '#E31837',
    team: 'arbys-ops',
    tagline: "We Have The Meats",
    channels: ['drive-thru', 'in-store', 'delivery'],
    menu: [
      { id: 1, name: 'Roast Beef Classic',  price: 5.99,  category: 'sandwiches' },
      { id: 2, name: 'Beef & Cheddar',      price: 6.99,  category: 'sandwiches' },
      { id: 3, name: 'Curly Fries Large',   price: 2.99,  category: 'sides'      },
      { id: 4, name: 'Mozzarella Sticks',   price: 4.99,  category: 'sides'      },
      { id: 5, name: 'Jamocha Shake',       price: 3.99,  category: 'drinks'     },
    ],
  },
  bww: {
    name: 'Buffalo Wild Wings',
    color: '#F5A800',
    team: 'bww-ops',
    tagline: "Wings. Beer. Sports.",
    channels: ['dine-in', 'takeout', 'delivery'],
    menu: [
      { id: 1, name: 'Traditional Wings 6pc', price: 9.99,  category: 'wings'      },
      { id: 2, name: 'Boneless Wings 6pc',    price: 8.99,  category: 'wings'      },
      { id: 3, name: 'Street Tacos',           price: 11.99, category: 'entrees'    },
      { id: 4, name: 'Loaded Nachos',          price: 10.99, category: 'shareables' },
      { id: 5, name: 'Draft Beer',             price: 6.99,  category: 'drinks'     },
    ],
  },
  sonic: {
    name: 'Sonic Drive-In',
    color: '#005FA3',
    team: 'sonic-ops',
    tagline: "America's Drive-In",
    channels: ['drive-in', 'drive-thru', 'delivery'],
    menu: [
      { id: 1, name: 'Footlong Coney',      price: 4.99, category: 'hot-dogs' },
      { id: 2, name: 'SONIC Blast',          price: 4.49, category: 'desserts' },
      { id: 3, name: 'Tots Large',           price: 2.99, category: 'sides'    },
      { id: 4, name: 'Route 44 Drink',       price: 2.49, category: 'drinks'   },
      { id: 5, name: 'Double Cheeseburger',  price: 5.99, category: 'burgers'  },
    ],
  },
  dunkin: {
    name: "Dunkin'",
    color: '#FF671F',
    team: 'dunkin-ops',
    tagline: "America Runs on Dunkin'",
    channels: ['in-store', 'drive-thru', 'mobile-order'],
    menu: [
      { id: 1, name: 'Medium Hot Coffee',    price: 2.49, category: 'coffee'     },
      { id: 2, name: 'Cold Brew',             price: 3.99, category: 'coffee'     },
      { id: 3, name: 'Glazed Donut',          price: 1.29, category: 'donuts'     },
      { id: 4, name: 'Bacon Egg & Cheese',    price: 4.99, category: 'sandwiches' },
      { id: 5, name: 'Munchkins 10pk',        price: 3.99, category: 'donuts'     },
    ],
  },
  'baskin-robbins': {
    name: 'Baskin-Robbins',
    color: '#E8256A',
    team: 'br-ops',
    tagline: "31 Flavors of Fun",
    channels: ['in-store', 'online', 'catering'],
    menu: [
      { id: 1, name: 'Single Scoop',       price: 3.49,  category: 'scoops'  },
      { id: 2, name: 'Double Scoop',        price: 4.99,  category: 'scoops'  },
      { id: 3, name: 'Sundae',              price: 5.99,  category: 'sundaes' },
      { id: 4, name: 'Milkshake',           price: 6.49,  category: 'drinks'  },
      { id: 5, name: 'Ice Cream Cake (8")', price: 24.99, category: 'cakes'   },
    ],
  },
  'jimmy-johns': {
    name: "Jimmy John's",
    color: '#C8102E',
    team: 'jj-ops',
    tagline: "Freaky Fast Delivery",
    channels: ['in-store', 'delivery', 'catering'],
    menu: [
      { id: 1, name: '#1 Pepe',                price: 8.99, category: 'sandwiches'      },
      { id: 2, name: '#6 The Veggie',           price: 8.49, category: 'sandwiches'      },
      { id: 3, name: '#9 Italian Night Club',   price: 9.99, category: 'sandwiches'      },
      { id: 4, name: 'Slim 1 Ham & Cheese',     price: 7.49, category: 'slim-sandwiches' },
      { id: 5, name: 'Chocolate Chip Cookie',   price: 1.29, category: 'sides'           },
    ],
  },
};

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
    service:   'inspire-brands-platform',
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
    service:  `inspire-${brand}-pos`,
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

  // Child span surfaces as inspire-{brand}-loyalty in APM service map
  await tracer.trace('loyalty.member_lookup', {
    service:  `inspire-${brand}-loyalty`,
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

  // Child span surfaces as inspire-{brand}-delivery in APM service map
  await tracer.trace('delivery.get_estimate', {
    service:  `inspire-${brand}-delivery`,
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

  return `You are the Inspire Brands Digital Operations Assistant — an AI embedded in the live Datadog observability demo platform.

CURRENT PLATFORM STATUS:
${brandStatus}
${extras || '  ✅ No active incidents'}

PLATFORM ARCHITECTURE:
- 6 brands: Arby's, Buffalo Wild Wings, Sonic Drive-In, Dunkin', Baskin-Robbins, Jimmy John's
- Each brand has a dedicated Datadog team (arbys-ops, bww-ops, sonic-ops, dunkin-ops, br-ops, jj-ops)
- 3 APM services per brand: inspire-{brand}-pos, inspire-{brand}-loyalty, inspire-{brand}-delivery
- 19 services total in the Datadog Service Catalog with team ownership
- 21 monitors: 3 per brand (POS errors, POS p95 latency, order volume anomaly) + 3 cross-brand
- 7 synthetic tests: platform health check + POS order test per brand
- Unified tagging: brand:, team:, channel:, env:, service:

DATADOG FEATURES IN THIS DEMO:
- Teams: Brand-level ownership and alert routing — each brand's monitors alert to its team
- APM Service Map: Shows 19 services with parent-child relationships by brand
- Service Catalog: Full service registry with team ownership, descriptions, and dashboard links
- Monitors: Per-brand POS health + cross-brand shared-service monitors
- Synthetics: Automated order placement tests per brand
- Log Management: Structured logs tagged by brand and team, searchable in real time
- LLM Observability: This very conversation is being traced in Datadog! (ml_app: inspire-brands-assistant)

DEMO SCENARIOS (available in the UI):
- POS Outage (per brand): toggle flag → 503 errors → POS error monitor fires → routes to brand team
- Slow POS (per brand): toggle flag → 3× latency → p95 monitor fires
- Loyalty Degraded (all brands): shared service failure impacting all 6 brands simultaneously
- Delivery Surge (all brands): 3× ETAs → delivery SLO monitor fires

Be conversational, specific, and demo-ready. Reference exact Datadog URLs and features when helpful. Keep answers to 2-4 sentences unless a longer explanation is needed.`;
}

// ── Smart mock — context-aware responses from live state ──
function mockResponse(message) {
  const q   = message.toLowerCase();
  const now = new Date().toLocaleTimeString();

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
    return `Datadog Teams gives each brand its own operational identity. The platform has **7 teams**: \`inspire-platform\` for shared infrastructure, plus one per brand — \`arbys-ops\`, \`bww-ops\`, \`sonic-ops\`, \`dunkin-ops\`, \`br-ops\`, and \`jj-ops\`.\n\nEvery monitor is tagged \`team:<brand>-ops\`, so alerts route directly to the right team's Slack channel. A Sonic POS error never lands in the Dunkin' queue. The Service Catalog also maps all 19 APM services to their owning team, so there's no ambiguity about who's on-call for what.`;
  }

  if (q.includes('outage') || q.includes('trigger') || q.includes('incident') || q.includes('simulate')) {
    const targetBrand = BRAND_KEYS.find(k => q.includes(k) || q.includes(BRANDS[k].name.toLowerCase())) || 'sonic';
    const b = BRANDS[targetBrand];
    return `When you trigger a **${b.name} POS outage** using the demo panel, the \`${targetBrand}-pos-outage\` feature flag flips to \`true\`. All POST /api/${targetBrand}/orders calls immediately return **HTTP 503**, and the DogStatsD metric \`inspire.pos.errors{brand:${targetBrand}}\` starts climbing.\n\nWithin ~30 seconds, the monitor **[${b.name}] POS Error Rate > 5 errors in 5m** fires. The alert routes to \`${b.team}\` with the triage runbook already embedded in the notification. You can watch the error spike live in the [${b.name} dashboard](https://app.datadoghq.com/dashboard/${BRANDS[targetBrand] ? Object.entries({"arbys":"f75-z6m-tar","bww":"q5d-bjs-bse","sonic":"nxt-4cb-fca","dunkin":"yd2-vab-79j","baskin-robbins":"mu7-y5j-aw3","jimmy-johns":"tap-3s5-x26"})[BRAND_KEYS.indexOf(targetBrand)]?.[1] : "3t7-6rx-4xc"}) and in APM under \`inspire-${targetBrand}-pos\`.`;
  }

  if (q.includes('tag') || q.includes('tagging') || q.includes('unified service')) {
    return `The platform uses **Datadog Unified Service Tagging** across every signal:\n\n• \`service:inspire-brands-platform\` — the top-level service\n• \`brand:<key>\` — e.g. \`brand:sonic\`, \`brand:dunkin\`\n• \`team:<brand>-ops\` — ownership tag for alert routing\n• \`channel:<channel>\` — e.g. \`channel:drive-thru\`, \`channel:delivery\`\n• \`env:local\` + \`version:1.0.0\` — standard UST tags\n\nAll metrics, logs, and APM traces carry the same tag set, which means you can pivot from a log error → correlated trace → owning team without any manual correlation. That's the power of consistent tagging at ingestion time.`;
  }

  if (q.includes('monitor') || q.includes('alert') || q.includes('slo')) {
    return `The platform has **21 monitors** across 3 categories:\n\n**Per-brand (18 monitors):** Each of the 6 brands has:\n• POS Error Rate > 5 errors/5min (P2)\n• POS p95 Latency > 1500ms (P3)\n• Anomalous Order Volume — anomaly detection (P3)\n\n**Cross-brand (3 monitors):**\n• Platform-Wide Error Rate > 20 HTTP 500s/5min (P1)\n• Loyalty Service Errors > 10/5min — impacts all 6 brands (P2)\n• Delivery ETA p95 > 60 minutes (P2)\n\nAll monitors now have embedded **runbooks, Slack routing, PagerDuty escalation paths**, and brand-specific triage steps. There are also **6 SLOs** — one availability SLO per brand with 99.5% / 7d and 99.0% / 30d targets.`;
  }

  if (q.includes('apm') || q.includes('service map') || q.includes('trace') || q.includes('service')) {
    return `APM shows **19 services** in the service map. The platform service \`inspire-brands-platform\` is the parent, with 3 child services per brand: \`inspire-<brand>-pos\`, \`inspire-<brand>-loyalty\`, and \`inspire-<brand>-delivery\`.\n\nEach brand's services are separated using \`tracer.trace()\` with a custom \`service:\` override — so Sonic's POS errors never inflate Dunkin's error rate. In the APM Service Map you'll see the 6 brands fanning out from the platform with clear parent-child relationships and latency/error indicators per service.`;
  }

  if (q.includes('log') || q.includes('logging')) {
    return `Every API call emits a structured JSON log with \`brand\`, \`team\`, \`trace_id\`, and \`duration_ms\` fields. Logs are shipped directly to Datadog via \`datadog-winston\`, correlated with APM traces via log injection.\n\nIn Log Management, you can filter by \`brand:sonic\` to see only Sonic's logs, or by \`status:error\` + \`brand:arbys\` to investigate Arby's errors in isolation. The Log Flood button in the demo UI sends a burst of realistic mixed-level logs across all brands — great for demonstrating log search and faceting.`;
  }

  if (q.includes('loyalty') || q.includes('delivery') || q.includes('shared service')) {
    return `Loyalty and Delivery are **shared services** — they span all 6 brands. When you toggle **Loyalty Degraded**, all brands simultaneously experience a 40% lookup failure rate and 4× latency, because they all call the same \`inspire-<brand>-loyalty\` APM services backed by the same upstream.\n\nThis is a great demo for showing how a single shared service failure cascades across an entire brand portfolio — and why the Loyalty monitor is tagged at the platform level rather than per-brand. The cross-brand monitor fires once, not 6 times.`;
  }

  if (q.includes('cost') || q.includes('spend') || q.includes('usage') || q.includes('budget')) {
    return `The Global Operations Dashboard includes a **Cost & Observability Spend** section showing:\n\n• Datadog estimated log ingestion bytes over time\n• Custom metric count trends\n• A derived Cost/Order metric — infrastructure spend normalized by order volume\n\nFor full cost allocation by brand/team, go to [Cloud Cost Management](https://app.datadoghq.com/cost/summary). Because every metric is tagged \`team:<brand>-ops\`, you can filter costs by team to see per-brand observability spend — great for internal chargeback conversations.`;
  }

  if (q.includes('data') || q.includes('pipeline') || q.includes('quality') || q.includes('freshness')) {
    return `The platform emits **Data Observability metrics** every 15 seconds per brand:\n\n• \`inspire.data.quality_score\` — 0–100, degrades automatically during POS outages\n• \`inspire.data.menu_sync_age_seconds\` — cycles every ~5 minutes, alerts if stale >4 min\n• \`inspire.data.inventory_lag_ms\` — inventory sync latency with realistic jitter\n• \`inspire.data.pipeline_queue_depth\` — surges 3× during Delivery Surge scenarios\n\nAll of these are visible in the **Global Operations Dashboard** under the Data Pipeline Observability section.`;
  }

  if (q.includes('synthetic') || q.includes('synthetics')) {
    return `There are **7 synthetic tests** running: one platform health check on GET /health, plus one POS order test per brand that sends a real POST /api/<brand>/orders request every few minutes.\n\nWhen a POS outage flag is active, the synthetic immediately starts failing and the synthetic alert fires — giving you a true end-to-end availability signal that's independent of metrics. In the demo you'll see synthetics flip from 🟢 to 🔴 within one test cycle of toggling a POS outage.`;
  }

  // Generic fallback
  return `Great question about the Inspire Brands platform! This demo spans **6 brands** (Arby's, Buffalo Wild Wings, Sonic, Dunkin', Baskin-Robbins, Jimmy John's) with full Datadog coverage: APM (19 services), 21 monitors with P1–P3 triage runbooks, 6 brand SLOs, synthetics, structured logs, data pipeline observability, and cost attribution.\n\nTry asking about: brand status, Teams ownership, the tagging strategy, APM service map, monitors and SLOs, loyalty/delivery shared services, or triggering an outage scenario.`;
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
        kind: 'llm', name: 'inspire_brands_chat',
        modelName: 'claude-sonnet-4-6', modelProvider: 'anthropic',
        sessionId, mlApp: 'inspire-brands-assistant',
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
          kind: 'llm', name: 'inspire_brands_chat',
          modelName: 'inspire-assistant-v1', modelProvider: 'inspire-internal',
          sessionId, mlApp: 'inspire-brands-assistant',
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

    dogstatsd.increment('llm.requests',      1,                   [`brand:${brandTag}`, 'model:inspire-assistant-v1', 'app:inspire-brands-assistant']);
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
  logger.info('inspire-brands-platform started', {
    port:   PORT,
    env:    process.env.DD_ENV || 'local',
    brands: BRAND_KEYS.length,
    teams:  [...new Set(BRAND_KEYS.map(b => BRANDS[b].team))],
  });
  dogstatsd.increment('platform.started');
});
