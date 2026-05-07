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

# ── Start Node directly ───────────────────────────────────────────────────────
echo "🚀 Starting server..."
cd app
exec node server.js
