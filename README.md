# Multi-Brand Platform × Datadog Demo

A full-stack observability demo simulating a multi-brand platform (restaurant, retail, or any industry with divisions/brands) with end-to-end Datadog instrumentation across APM, RUM, Logs, Synthetics, LLM Observability, and Application Security.

All customer-specific data — company name, brands, teams, metric prefix, service names — lives in a single config file (`app/customer.config.js`). Swap the config and re-run the setup scripts to stand up a fresh demo for any customer.

The repo ships with a sample multi-brand restaurant configuration as the default.

---

## What This Demos

| Datadog Product | What you'll see |
|---|---|
| **APM / Service Map** | N+1 services — 3 per brand (POS, loyalty, delivery) + platform parent |
| **Logs** | Structured JSON logs tagged by `brand:` and `team:`, correlated with APM traces |
| **RUM** | Per-brand web apps with sessions isolated by `@brand` attribute |
| **Monitors** | Per-brand × 3 + 3 cross-brand shared-service monitors |
| **Synthetics** | Automated tests via a local Private Location Docker worker |
| **LLM Observability** | Every chatbot request traced in Datadog (`ml_app` from config) |
| **App Security (ASM)** | WAF + IAST enabled; attack surface demo endpoints for SQLi, XSS, path traversal |
| **Teams** | Per-brand team ownership — monitors route to the right team |
| **Dashboards** | Global executive dashboard + per-brand dashboards |
| **Custom Metrics** | DogStatsD: orders, revenue, POS latency, loyalty lookups, data pipeline health |

---

## Architecture

```
Browser (RUM SDK)
      │
      ▼
┌──────────────────────────────────────────────────┐
│  Docker: {platform} (:3000)                      │
│                                                  │
│  Express + dd-trace (APM)                        │
│  ├── /api/:brand/orders   → {prefix}-{brand}-pos │
│  ├── /api/:brand/loyalty  → {prefix}-{brand}-loyalty
│  ├── /api/:brand/delivery → {prefix}-{brand}-delivery
│  ├── /api/chat            → LLMObs + Claude      │
│  ├── /api/security/*      → ASM demo endpoints   │
│  └── /brands/:brand       → per-brand RUM web app│
│                                                  │
│  Winston → datadog-winston → DD Logs             │
│  hot-shots → DogStatsD → DD Metrics              │
└──────────────────────────────────────────────────┘
      │                        │
      ▼                        ▼
Datadog Agent (native Mac)   DD Intake (agentless logs/LLMObs)
      │
      ▼
┌──────────────────────────────────────────────────┐
│  Docker: dd-private-location                     │
│  Synthetics worker → http://app:3000             │
└──────────────────────────────────────────────────┘
```

The Datadog Agent runs natively on the Mac host. The app container reaches it via `host.docker.internal`.

---

## Creating a New Customer Demo

All customer-specific data is in **`app/customer.config.js`**. To set up a new customer:

1. Update `app/customer.config.js` with the new company name, brands, teams, and service prefix
2. Set `DD_SERVICE` in `.env` to match the `platform` value in the config
3. Run the setup scripts (see below)
4. Rebuild: `docker compose up --build -d`

### Config fields

```js
module.exports = {
  company:          'Acme Corp',          // display name
  platform:         'acme-platform',      // DD_SERVICE — Datadog service identifier
  servicePrefix:    'acme',               // prefix for brand APM services (acme-brand-pos)
  metricPrefix:     'acme',               // DogStatsD metric namespace (acme.orders.created)
  mlApp:            'acme-assistant',     // LLM Observability ml_app name
  platformTeam:     'acme-platform',      // Datadog team handle for cross-brand resources
  platformTeamName: 'Acme Platform Team',
  hostname:         'acme-demo-host',

  dashboardTitle:       '🏢 Acme Corp — Digital Platform Overview',
  dashboardDescription: 'Cross-brand observability for Acme Corp',

  brandLogoUrls: { 'brand-key': 'https://...' },  // optional

  brands: [
    {
      key:      'brand-key',        // URL-safe, used in /api/:brand routes
      name:     'Brand Name',
      color:    '#hex',
      team:     'brand-ops',        // Datadog team handle
      tagline:  'Brand tagline',
      channels: ['channel-a', 'channel-b'],
      menu: [
        { id: 1, name: 'Item Name', price: 9.99, category: 'category' },
      ],
    },
  ],
};
```

---

## Prerequisites

- **Docker Desktop** (running)
- **Datadog account** on `datadoghq.com` (or update `DD_SITE`)
- **Datadog Agent** running locally (for APM traces + DogStatsD metrics)
- **Node.js 18+** (only needed to run the setup scripts, not the app itself)
- **Anthropic API key** (optional — chatbot falls back to a smart mock without it)

---

## Quick Start

### 1. Clone and configure

```bash
git clone git@github.com:rf00028/datadogdemo-claude.git
cd datadogdemo-claude

cp .env.example .env
# Edit .env and fill in your keys:
#   DD_API_KEY, DD_APP_KEY, ANTHROPIC_API_KEY
```

### 2. Run the setup scripts (one-time)

These scripts call the Datadog API to create all cloud-side resources:

```bash
# Create teams, monitors, synthetics, service catalog, and dashboards
node setup-datadog.js

# Create RUM applications and add RUM widgets to dashboards
node setup-rum.js

# Create a Private Location and update synthetics to run against it
node setup-private-location.js
```

`setup-datadog.js` writes dashboard/monitor IDs to `app/public/dd-assets.json`. The UI uses these for deep-link buttons into Datadog. `setup-rum.js` appends RUM application IDs to the same file.

### 3. Start the stack

```bash
./start.sh
```

This builds the Docker image and starts both containers. The app is at **http://localhost:3000**.

Or manually:

```bash
docker compose up --build -d
docker compose logs -f app   # stream logs
docker compose down          # stop
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `DD_API_KEY` | Yes | Datadog API key — ships logs and metrics |
| `DD_APP_KEY` | Yes (setup only) | Datadog Application key — used by setup scripts |
| `ANTHROPIC_API_KEY` | No | Powers the real Claude chatbot. Without it, a smart mock is used (still creates LLMObs spans) |
| `DD_SERVICE` | No | Overrides the service name (default: value in `customer.config.js`) |
| `DD_SITE` | No | Datadog site (default: `datadoghq.com`) |
| `DD_ENV` | No | Environment tag (default: `local`) |
| `DD_VERSION` | No | Version tag (default: `1.0.0`) |

---

## Demo Scenarios

All scenarios are controlled from the main dashboard at http://localhost:3000.

### Per-brand failure flags

Each brand has two toggle flags:

| Flag | Effect |
|---|---|
| **POS Outage** | All `POST /api/:brand/orders` return HTTP 503. Fires the `[Brand] POS Error Rate` monitor within ~30 seconds. |
| **Slow POS** | Order processing latency increases 3×. Fires the `[Brand] POS p95 Latency` monitor. |

### Cross-brand shared service failures

| Flag | Effect |
|---|---|
| **Loyalty Degraded** | 40% loyalty lookup failure rate + 4× latency across all brands simultaneously. Demonstrates shared service blast radius. |
| **Delivery Surge** | 3× delivery ETAs across all brands. DogStatsD queue depth metrics also surge. |

### Security demo (ASM)

The **Security & ASM** section fires crafted HTTP requests at three intentionally open endpoints:

| Attack | Endpoint | What ASM detects |
|---|---|---|
| SQL injection | `GET /api/security/scan?q=' OR 1=1--` | SQLi pattern |
| XSS | `GET /api/security/scan?q=<script>...` | XSS payload |
| Path traversal | `GET /api/security/file?path=../../etc/passwd` | Directory traversal |
| Auth bypass | `POST /api/security/login` | SQLi in login credentials |

View findings at [App Security → Signals](https://app.datadoghq.com/security/appsec).

### LLM Observability

The **AI Assistant** chatbot sends prompts through `/api/chat`. Every request — real Claude or mock — creates a Datadog LLMObs span with input/output messages, token counts, and brand context tag.

View traces at [LLM Observability](https://app.datadoghq.com/llm/traces).

---

## Tagging Strategy

Every signal (metric, log, trace, RUM event) carries a consistent tag set:

```
service:{platform}           # top-level service
brand:{key}                  # e.g. brand:brand-a
team:{brand}-ops             # e.g. team:brand-a-ops
channel:{channel}            # e.g. channel:drive-thru
env:local
version:1.0.0
```

All monitor routing, Service Catalog ownership, and cost attribution rely on these tags being consistent across every signal.

---

## File Structure

```
dd-demo-app/
├── app/
│   ├── customer.config.js     # ← all customer-specific data lives here
│   ├── server.js              # Express app — APM, logs, metrics, ASM, LLMObs
│   ├── package.json
│   └── public/
│       ├── index.html         # Main platform dashboard UI
│       ├── dd-assets.json     # Written by setup scripts — dashboard/RUM IDs
│       └── brands/
│           ├── app.html       # Per-brand RUM web app (loaded at /brands/:brand)
│           └── inspire.html   # Global portal (/inspire)
├── setup-datadog.js           # Creates teams, monitors, synthetics, dashboards
├── setup-rum.js               # Creates RUM apps, adds RUM widgets to dashboards
├── setup-private-location.js  # Creates DD private location, updates synthetics
├── docker-compose.yml         # App + private-location services
├── Dockerfile                 # Node 20 Alpine image
├── start.sh                   # One-command build + up
├── .env.example               # Template — copy to .env and fill in keys
└── .gitignore                 # Excludes .env, private-location-config.json, node_modules
```

---

## Monitors

Per-brand (3 per brand):
- `[Brand] POS Error Rate > 5 errors in 5m` (P2)
- `[Brand] POS p95 Latency > 1500ms` (P3)
- `[Brand] Anomalous Order Volume` — anomaly detection (P3)

Cross-brand (3):
- `Platform-Wide Error Rate > 20 HTTP 500s/5min` (P1)
- `Loyalty Service Errors > 10/5min` (P2)
- `Delivery ETA p95 > 60 minutes` (P2)

---

## Synthetics

Tests run via the **Private Location** Docker container (`dd-private-location`), reaching the app at `http://app:3000` on the internal Docker network.

- One platform health check: `GET /health`
- One POS order test per brand: `POST /api/:brand/orders`

The private location config lives in `private-location-config.json` (git-ignored — contains credentials).

---

## Useful Commands

```bash
# Rebuild and restart after code or config changes
docker compose up --build -d

# Stream app logs
docker compose logs -f app

# Check private location is connected
docker compose logs private-location

# Stop everything
docker compose down

# Re-run setup (e.g. for a new customer config)
node setup-datadog.js
node setup-rum.js
```
