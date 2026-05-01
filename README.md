# Inspire Brands × Datadog Demo Platform

A full-stack observability demo simulating a multi-brand restaurant technology platform (Arby's, Buffalo Wild Wings, Sonic Drive-In, Dunkin', Baskin-Robbins, Jimmy John's) with end-to-end Datadog instrumentation across APM, RUM, Logs, Synthetics, LLM Observability, and Application Security.

Built for live Datadog demos. Toggle realistic failure scenarios from the UI and watch signals propagate across APM, monitors, logs, and RUM in real time.

---

## What This Demos

| Datadog Product | What you'll see |
|---|---|
| **APM / Service Map** | 19 services — 3 per brand (POS, loyalty, delivery) + platform parent |
| **Logs** | Structured JSON logs tagged by `brand:` and `team:`, correlated with APM traces |
| **RUM** | Per-brand web apps with sessions isolated by `@brand` attribute |
| **Monitors** | 21 monitors — 18 per-brand + 3 cross-brand shared services |
| **Synthetics** | 7 automated tests via a local Private Location Docker worker |
| **LLM Observability** | Every chatbot request traced in Datadog (`ml_app: inspire-brands-assistant`) |
| **App Security (ASM)** | WAF + IAST enabled; attack surface demo endpoints for SQLi, XSS, path traversal |
| **Teams** | 7 teams with service ownership — monitors route to the right brand team |
| **Dashboards** | Global executive dashboard + 6 per-brand dashboards |
| **Custom Metrics** | DogStatsD: orders, revenue, POS latency, loyalty lookups, data pipeline health |

---

## Architecture

```
Browser (RUM SDK)
      │
      ▼
┌─────────────────────────────────────────────┐
│  Docker: inspire-brands-platform (:3000)    │
│                                             │
│  Express + dd-trace (APM)                   │
│  ├── /api/:brand/orders   → inspire-{brand}-pos      │
│  ├── /api/:brand/loyalty  → inspire-{brand}-loyalty  │
│  ├── /api/:brand/delivery → inspire-{brand}-delivery │
│  ├── /api/chat            → LLMObs + Claude          │
│  ├── /api/security/*      → ASM demo endpoints       │
│  └── /brands/:brand       → per-brand RUM web app    │
│                                             │
│  Winston → datadog-winston → DD Logs        │
│  hot-shots → DogStatsD → DD Metrics         │
└─────────────────────────────────────────────┘
      │                        │
      ▼                        ▼
Datadog Agent (native Mac)   DD Intake (agentless logs/LLMObs)
      │
      ▼
┌─────────────────────────────────────────────┐
│  Docker: dd-private-location                │
│  Synthetics worker → http://app:3000        │
└─────────────────────────────────────────────┘
```

The Datadog Agent runs natively on the Mac host. The app container reaches it via `host.docker.internal`.

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

These scripts call the Datadog API to create all the cloud-side resources:

```bash
# Install setup script dependencies (not the app — just the scripts)
npm install node-fetch   # only if prompted; scripts use built-in https

# Create teams, monitors, synthetics, service catalog, and dashboards
node setup-datadog.js

# Create RUM applications and add RUM widgets to dashboards
node setup-rum.js

# Create a Private Location and update synthetics to run against it
node setup-private-location.js
```

`setup-datadog.js` writes IDs to `app/public/dd-assets.json`, which the UI uses for deep-link buttons into Datadog. `setup-rum.js` appends RUM application IDs to the same file.

> **Re-running:** The scripts are idempotent for most resources. If you re-run on a fresh account you may need to delete old resources in the Datadog UI first to avoid name conflicts.

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
| `DD_APP_KEY` | Yes (setup only) | Datadog Application key — used by setup scripts to call the management API |
| `ANTHROPIC_API_KEY` | No | Powers the real Claude chatbot. Without it, a smart mock is used (still creates LLMObs spans) |
| `DD_SITE` | No | Datadog site (default: `datadoghq.com`) |
| `DD_ENV` | No | Environment tag (default: `local`) |
| `DD_VERSION` | No | Version tag (default: `1.0.0`) |

---

## Demo Scenarios

All scenarios are controlled from the **main dashboard** at http://localhost:3000.

### Per-brand failure flags

Each of the 6 brands has two toggle flags:

| Flag | Effect |
|---|---|
| **POS Outage** | All `POST /api/:brand/orders` return HTTP 503. Fires the `[Brand] POS Error Rate` monitor within ~30 seconds. |
| **Slow POS** | Order processing latency increases 3×. Fires the `[Brand] POS p95 Latency` monitor. |

### Cross-brand shared service failures

| Flag | Effect |
|---|---|
| **Loyalty Degraded** | 40% loyalty lookup failure rate + 4× latency across all 6 brands simultaneously. Demonstrates shared service blast radius. |
| **Delivery Surge** | 3× delivery ETAs across all brands. DogStatsD queue depth metrics also surge. |

### Security demo (ASM)

The **Security & ASM** section in the UI fires crafted HTTP requests at three intentionally open endpoints:

| Attack | Endpoint | What ASM detects |
|---|---|---|
| SQL injection | `GET /api/security/scan?q=' OR 1=1--` | SQLi pattern |
| XSS | `GET /api/security/scan?q=<script>...` | XSS payload |
| Path traversal | `GET /api/security/file?path=../../etc/passwd` | Directory traversal |
| Auth bypass | `POST /api/security/login` | SQLi in login credentials |

Watch findings appear in [App Security → Signals](https://app.datadoghq.com/security/appsec).

### LLM Observability

The **AI Assistant** chatbot in the UI sends prompts through the `/api/chat` endpoint. Every request — whether using a real Claude model or the mock — creates a Datadog LLMObs span with:

- Input/output messages
- Token counts
- `brand:` context tag
- `session_id` for multi-turn correlation

View traces at [LLM Observability](https://app.datadoghq.com/llm/traces). Use the **LLM Quick-Fire** buttons in the UI to send a burst of varied prompts.

### Log flood

The **Flood Logs** button fires up to 200 structured log events across all brands at randomized info/warn/error levels. Useful for demonstrating Log Management search, faceting, and alerting.

---

## URL Reference

| URL | What it is |
|---|---|
| `http://localhost:3000` | Main platform dashboard |
| `http://localhost:3000/inspire` | Inspire Brands global portal (RUM: `brand:global`) |
| `http://localhost:3000/brands/arbys` | Arby's brand web app (RUM: `brand:arbys`) |
| `http://localhost:3000/brands/bww` | Buffalo Wild Wings brand web app |
| `http://localhost:3000/brands/sonic` | Sonic Drive-In brand web app |
| `http://localhost:3000/brands/dunkin` | Dunkin' brand web app |
| `http://localhost:3000/brands/baskin-robbins` | Baskin-Robbins brand web app |
| `http://localhost:3000/brands/jimmy-johns` | Jimmy John's brand web app |
| `http://localhost:3000/health` | Health check endpoint |

---

## Tagging Strategy

Every signal (metric, log, trace, RUM event) carries a consistent tag set:

```
service:inspire-brands-platform
brand:<key>           # e.g. brand:sonic
team:<brand>-ops      # e.g. team:sonic-ops
channel:<channel>     # e.g. channel:drive-thru
env:local
version:1.0.0
```

This enables pivoting from any signal to its owning team without manual correlation. It's the basis for all monitor routing and Service Catalog ownership.

---

## APM Service Map

The platform generates 19 APM services:

- `inspire-brands-platform` — parent service
- Per brand × 3: `inspire-{brand}-pos`, `inspire-{brand}-loyalty`, `inspire-{brand}-delivery`

Each child service is created with a `tracer.trace()` call using a custom `service:` override, so APM error rates and latency are isolated per brand. A Sonic POS error doesn't affect Dunkin's error rate.

---

## Monitors

21 monitors total:

**Per-brand (18):** For each of the 6 brands:
- `[Brand] POS Error Rate > 5 errors in 5m` (P2)
- `[Brand] POS p95 Latency > 1500ms` (P3)
- `[Brand] Anomalous Order Volume` — anomaly detection (P3)

**Cross-brand (3):**
- `Platform-Wide Error Rate > 20 HTTP 500s/5min` (P1)
- `Loyalty Service Errors > 10/5min` (P2)
- `Delivery ETA p95 > 60 minutes` (P2)

All monitors include triage runbooks and are tagged to their owning team.

---

## Synthetics

7 synthetic API tests run via the **Private Location** Docker container:

- `Inspire Brands — Platform Health Check` — hits `/health`
- `[Brand] POS Order Synthetic` (× 6) — places a real order at `/api/:brand/orders`

The private location worker runs as `dd-private-location` in Docker and reaches the app at `http://app:3000` on the internal Docker network (not `localhost`). Its config lives in `private-location-config.json` (git-ignored — contains credentials).

---

## File Structure

```
dd-demo-app/
├── app/
│   ├── server.js              # Express app — APM, logs, metrics, ASM, LLMObs
│   ├── package.json
│   └── public/
│       ├── index.html         # Main platform dashboard UI
│       ├── dd-assets.json     # Written by setup scripts — dashboard/RUM IDs
│       └── brands/
│           ├── app.html       # Per-brand RUM web app (loaded at /brands/:brand)
│           └── inspire.html   # Global portal RUM page (/inspire)
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

## SSH / Git Notes

This repo uses a dedicated GitHub SSH key to avoid conflicts with other deploy keys:

```bash
# Push requires bypassing the SSH agent (which may offer a deploy key)
SSH_AUTH_SOCK="" git push

# The correct key is configured in git config:
# core.sshCommand = ssh -i ~/.ssh/id_ed25519_github -o IdentitiesOnly=yes -o AddKeysToAgent=no
```

If you clone fresh on a new machine, configure your SSH key normally — this note only applies to the original development machine.

---

## Useful Commands

```bash
# Rebuild and restart after code changes
docker compose up --build -d

# Stream app logs
docker compose logs -f app

# Check private location is connected
docker compose logs private-location

# Stop everything
docker compose down

# Re-run setup (e.g. after account change)
node setup-datadog.js
node setup-rum.js
```
