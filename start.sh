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

# ── Docker Compose ────────────────────────────────────────────────────────────
echo "🐳 Building and starting containers..."
docker compose up --build -d

echo ""
echo -e "${GREEN}✓ Stack is up!${NC}"
echo ""
echo "  🌐 App frontend:     http://localhost:3000"
echo "  ❤️  Health check:     http://localhost:3000/health"
echo "  📊 Datadog APM:      https://app.datadoghq.com/apm/services"
echo "  📝 Datadog Logs:     https://app.datadoghq.com/logs"
echo "  📈 Metrics explorer: https://app.datadoghq.com/metric/explorer"
echo ""
echo "  Logs: docker compose logs -f app"
echo "  Stop: docker compose down"
echo ""
