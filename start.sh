#!/usr/bin/env bash
set -e

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${GREEN}"
echo "  ____  ____     ____                          "
echo " |  _ \|  _ \   |  _ \  ___ _ __ ___   ___   "
echo " | | | | | | |  | | | |/ _ \ '_ \` _ \ / _ \ "
echo " | |_| | |_| |  | |_| |  __/ | | | | | (_) |"
echo " |____/|____/   |____/ \___|_| |_| |_|\___/  "
echo -e "${NC}"
echo "  Express + Datadog Observability Demo"
echo ""

# ── .env setup ────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo -e "${YELLOW}⚠  Created .env from .env.example — please fill in your DD_API_KEY!${NC}"
  fi
fi

# Load .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Validate API key
if [ -z "$DD_API_KEY" ] || [ "$DD_API_KEY" = "your_api_key_here" ]; then
  echo -e "${RED}✗ DD_API_KEY is not set. Edit .env and add your key, then re-run.${NC}"
  echo "  → app.datadoghq.com → Organization Settings → API Keys"
  exit 1
fi

echo -e "${GREEN}✓ DD_API_KEY found${NC}"
echo -e "${GREEN}✓ Site: ${DD_SITE:-datadoghq.com}${NC}"
echo -e "${GREEN}✓ Env:  ${DD_ENV:-local}${NC}"
echo ""

# ── Datadog Agent check ───────────────────────────────────────────────────────
DD_AGENT_HOST="${DD_AGENT_HOST:-localhost}"
DD_TRACE_AGENT_PORT="${DD_TRACE_AGENT_PORT:-8126}"
if curl -sf "http://${DD_AGENT_HOST}:${DD_TRACE_AGENT_PORT}/info" >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Datadog Agent reachable at ${DD_AGENT_HOST}:${DD_TRACE_AGENT_PORT}${NC}"
else
  echo -e "${YELLOW}⚠  Datadog Agent not found at ${DD_AGENT_HOST}:${DD_TRACE_AGENT_PORT} — traces won't ship${NC}"
fi
echo ""

# ── Install deps if needed ────────────────────────────────────────────────────
if [ ! -d app/node_modules ]; then
  echo "📦 Installing dependencies..."
  (cd app && npm install --silent)
fi

# ── Remind about optional one-time setup scripts ─────────────────────────────
echo "  Optional one-time setup scripts (run from repo root in a new terminal):"
echo "    node setup-incidents.js   # Incident Management + Workflow Automation"
echo "    node setup-sds.js         # Sensitive Data Scanner rules (PCI/PII)"
echo "    node setup-cost.js        # Cost Attribution dashboard"
echo ""

# ── Clear any OTEL env vars that would redirect dd-trace away from the Datadog Agent ──
# (Claude Code sets OTEL_TRACES_EXPORTER=otlp pointing to its own telemetry endpoint,
#  which causes dd-trace to send traces there instead of to localhost:8126)
unset OTEL_TRACES_EXPORTER
unset OTEL_EXPORTER_OTLP_ENDPOINT
unset OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
unset OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
unset OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
unset OTEL_EXPORTER_OTLP_PROTOCOL
unset OTEL_LOGS_EXPORTER
unset OTEL_METRICS_EXPORTER

# ── Start Node directly ───────────────────────────────────────────────────────
echo "🚀 Starting server..."
cd app
exec node server.js
