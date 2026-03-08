#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  EXTROPY ENGINE — Full Deploy (GrantFlow Backend + All Frontends)
# ═══════════════════════════════════════════════════════════════════════════════
#
#  SSH into VPS and paste this entire block:
#    ssh root@187.124.95.129
#    <paste everything below>
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_DIR="/root/extropy-engine"
WEBROOT="/var/www/extropyengine.com"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  EXTROPY ENGINE — Full Stack Deployment"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════════════════════════"

# ──────────────────────────────────────────────────────────────────────────────
#  PHASE 1: Pull latest code
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "▶ [PHASE 1] Pulling latest code from GitHub..."
cd "$REPO_DIR"
git pull origin main
echo "  ✓ Code updated"

# ──────────────────────────────────────────────────────────────────────────────
#  PHASE 2: Create .env file with placeholder values
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "▶ [PHASE 2] Setting up .env file..."

if [ ! -f "$REPO_DIR/.env" ]; then
  cat > "$REPO_DIR/.env" << 'ENV'
# ═══════════════════════════════════════════════════════════════
#  EXTROPY ENGINE — Environment Configuration
# ═══════════════════════════════════════════════════════════════

# ── Core Infrastructure ──────────────────────────────────────
POSTGRES_USER=extropy
POSTGRES_PASSWORD=extropy_dev
POSTGRES_DB=extropy_engine
DATABASE_URL=postgresql://extropy:extropy_dev@postgres:5432/extropy_engine
REDIS_URL=redis://redis:6379

# ── GrantFlow Discovery (Grants.gov S2S — optional) ─────────
# Register at https://www.grants.gov/web/grants/applicants/registration.html
# for AOR (Authorized Organization Representative) credentials
GRANTS_GOV_S2S_USER=
GRANTS_GOV_S2S_PASS=
GRANTS_GOV_CERT_PATH=

# ── GrantFlow Proposer (AI generation — optional) ───────────
# If set, enables GPT-4 powered proposal generation
# If blank, uses template-based generation (still works great)
OPENAI_API_KEY=

# ── Academia Bridge (academia.edu — required for uploads) ────
# Your academia.edu login credentials for automated paper uploads
ACADEMIA_EMAIL=
ACADEMIA_PASSWORD=
ACADEMIA_PROFILE_NAME=Randall Gossett
ENV
  echo "  ✓ .env created with placeholder values"
  echo "  ⚠ Fill in ACADEMIA_EMAIL and ACADEMIA_PASSWORD to enable auto-uploads"
else
  echo "  .env already exists, checking for new variables..."
  # Add any missing variables
  grep -q "GRANTS_GOV_S2S_USER" "$REPO_DIR/.env" || echo -e "\n# GrantFlow S2S\nGRANTS_GOV_S2S_USER=\nGRANTS_GOV_S2S_PASS=\nGRANTS_GOV_CERT_PATH=" >> "$REPO_DIR/.env"
  grep -q "OPENAI_API_KEY" "$REPO_DIR/.env" || echo -e "\n# AI Generation\nOPENAI_API_KEY=" >> "$REPO_DIR/.env"
  grep -q "ACADEMIA_EMAIL" "$REPO_DIR/.env" || echo -e "\n# Academia Bridge\nACADEMIA_EMAIL=\nACADEMIA_PASSWORD=\nACADEMIA_PROFILE_NAME=Randall Gossett" >> "$REPO_DIR/.env"
  echo "  ✓ .env updated with any missing variables"
fi

# ──────────────────────────────────────────────────────────────────────────────
#  PHASE 3: Ensure infrastructure is running
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "▶ [PHASE 3] Starting infrastructure (postgres + redis)..."

docker compose up -d postgres redis
echo "  Waiting for PostgreSQL to be ready..."
sleep 10

# Verify postgres is up
if docker compose exec -T postgres pg_isready -U extropy > /dev/null 2>&1; then
  echo "  ✓ PostgreSQL is healthy"
else
  echo "  ⚠ PostgreSQL slow to start, waiting 15 more seconds..."
  sleep 15
fi

# ──────────────────────────────────────────────────────────────────────────────
#  PHASE 4: Run database migrations
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "▶ [PHASE 4] Running database migrations..."

# Init DB (core tables)
if [ -f scripts/init-db.sql ]; then
  echo "  Applying init-db.sql..."
  docker compose exec -T postgres psql -U extropy -d extropy_engine < scripts/init-db.sql 2>&1 | tail -3
fi

# HomeFlow migrations
if [ -f packages/homeflow/migrations/001_init_homeflow.sql ]; then
  echo "  Applying HomeFlow migrations..."
  docker compose exec -T postgres psql -U extropy -d extropy_engine < packages/homeflow/migrations/001_init_homeflow.sql 2>&1 | tail -3
fi

# GrantFlow Discovery migrations
if [ -f packages/grantflow-discovery/migrations/001_init_grantflow_discovery.sql ]; then
  echo "  Applying GrantFlow Discovery migrations..."
  docker compose exec -T postgres psql -U extropy -d extropy_engine < packages/grantflow-discovery/migrations/001_init_grantflow_discovery.sql 2>&1 | tail -3
fi

# GrantFlow Proposer migrations
if [ -f packages/grantflow-proposer/migrations/001_init_grantflow_proposer.sql ]; then
  echo "  Applying GrantFlow Proposer migrations..."
  docker compose exec -T postgres psql -U extropy -d extropy_engine < packages/grantflow-proposer/migrations/001_init_grantflow_proposer.sql 2>&1 | tail -3
fi

# Academia Bridge migrations
if [ -f packages/academia-bridge/migrations/001_init_academia_bridge.sql ]; then
  echo "  Applying Academia Bridge migrations..."
  docker compose exec -T postgres psql -U extropy -d extropy_engine < packages/academia-bridge/migrations/001_init_academia_bridge.sql 2>&1 | tail -3
fi

echo "  ✓ All migrations applied"

# ──────────────────────────────────────────────────────────────────────────────
#  PHASE 5: Build and start all backend services
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "▶ [PHASE 5] Building and starting all backend services..."

# Build each service individually using 'docker build' to avoid docker-compose.yml
# validation errors from services that don't have Dockerfiles yet (dag-substrate, etc.)
BUILD_TARGETS=(
  "epistemology-engine:packages/epistemology-engine/Dockerfile"
  "signalflow:packages/signalflow/Dockerfile"
  "loop-ledger:packages/loop-ledger/Dockerfile"
  "reputation:packages/reputation/Dockerfile"
  "xp-mint:packages/xp-mint/Dockerfile"
  "homeflow:packages/homeflow/Dockerfile"
  "grantflow-discovery:packages/grantflow-discovery/Dockerfile"
  "grantflow-proposer:packages/grantflow-proposer/Dockerfile"
  "academia-bridge:packages/academia-bridge/Dockerfile"
)

for TARGET in "${BUILD_TARGETS[@]}"; do
  SVC="${TARGET%%:*}"
  DFILE="${TARGET##*:}"
  printf "  %-24s" "${SVC}"
  if docker build -q -t "extropy-engine-${SVC}" -f "${DFILE}" . > /dev/null 2>&1; then
    echo "built"
  else
    echo "FAILED"
    echo "    Retrying with output..."
    docker build -t "extropy-engine-${SVC}" -f "${DFILE}" . 2>&1 | tail -10
  fi
done

echo ""
echo "  Starting infrastructure..."
docker compose up -d postgres redis 2>&1 | tail -3
sleep 8

# Start services using docker run (bypasses broken docker-compose.yml entirely)
DOCKER_NETWORK="extropy-engine_default"
docker network create "$DOCKER_NETWORK" 2>/dev/null || true

start_service() {
  local NAME=$1 PORT=$2 SCHEMA=$3
  local ENV_EXTRA="${4:-}"
  
  # Stop and remove existing container
  docker rm -f "$NAME" 2>/dev/null || true
  
  docker run -d \
    --name "$NAME" \
    --network "$DOCKER_NETWORK" \
    --restart unless-stopped \
    -p "${PORT}:${PORT}" \
    -e "PORT=${PORT}" \
    -e "DATABASE_URL=postgresql://extropy:extropy_dev@postgres:5432/extropy_engine?schema=${SCHEMA}" \
    -e "REDIS_URL=redis://redis:6379" \
    -e "EPISTEMOLOGY_URL=http://epistemology-engine:4001" \
    -e "SIGNALFLOW_URL=http://signalflow:4002" \
    -e "LOOP_LEDGER_URL=http://loop-ledger:4003" \
    -e "REPUTATION_URL=http://reputation:4004" \
    -e "XP_MINT_URL=http://xp-mint:4005" \
    ${ENV_EXTRA} \
    "extropy-engine-${NAME}" > /dev/null 2>&1
  
  printf "  %-24s started on port %s\n" "$NAME" "$PORT"
}

echo "  Starting core services..."
start_service epistemology-engine 4001 epistemology
start_service signalflow 4002 signalflow
start_service loop-ledger 4003 ledger
start_service reputation 4004 reputation
start_service xp-mint 4005 mint

echo "  Starting homeflow..."
start_service homeflow 4015 homeflow

echo "  Starting grantflow services..."
start_service grantflow-discovery 4020 grantflow "-e GRANTFLOW_PROPOSER_URL=http://grantflow-proposer:4021"
start_service grantflow-proposer 4021 proposer "-e GRANTFLOW_DISCOVERY_URL=http://grantflow-discovery:4020 -e ACADEMIA_BRIDGE_URL=http://academia-bridge:4022"
start_service academia-bridge 4022 academia "-e ACADEMIA_PROFILE_NAME=Randall_Gossett"

echo "  Waiting 20 seconds for services to initialize..."
sleep 20

# ──────────────────────────────────────────────────────────────────────────────
#  PHASE 6: Deploy frontends to webroot
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "▶ [PHASE 6] Deploying frontends..."

# Ensure webroot exists
mkdir -p "$WEBROOT"

# Deploy dashboard
if [ -d dashboard ]; then
  echo "  Deploying dashboard → $WEBROOT/"
  cp dashboard/index.html "$WEBROOT/" 2>/dev/null || true
  cp dashboard/style.css "$WEBROOT/" 2>/dev/null || true
  cp dashboard/base.css "$WEBROOT/" 2>/dev/null || true
  cp dashboard/app.js "$WEBROOT/" 2>/dev/null || true
  cp dashboard/charts.js "$WEBROOT/" 2>/dev/null || true
  cp dashboard/data.js "$WEBROOT/" 2>/dev/null || true
  cp dashboard/dag-renderer.js "$WEBROOT/" 2>/dev/null || true
  cp dashboard/views.js "$WEBROOT/" 2>/dev/null || true
fi

# Deploy HomeFlow frontend
if [ -d frontends/homeflow-ui ]; then
  echo "  Deploying HomeFlow → $WEBROOT/homeflow/"
  mkdir -p "$WEBROOT/homeflow"
  cp frontends/homeflow-ui/index.html "$WEBROOT/homeflow/"
  cp frontends/homeflow-ui/styles.css "$WEBROOT/homeflow/"
  cp frontends/homeflow-ui/app.js "$WEBROOT/homeflow/"
fi

# Deploy Character Sheet
if [ -d frontends/character-sheet ]; then
  echo "  Deploying Character Sheet → $WEBROOT/character-sheet/"
  mkdir -p "$WEBROOT/character-sheet"
  cp frontends/character-sheet/index.html "$WEBROOT/character-sheet/"
  cp frontends/character-sheet/styles.css "$WEBROOT/character-sheet/"
  cp frontends/character-sheet/script.js "$WEBROOT/character-sheet/"
fi

# Deploy GrantFlow frontend
if [ -d frontends/grantflow-ui ]; then
  echo "  Deploying GrantFlow UI → $WEBROOT/grantflow/"
  mkdir -p "$WEBROOT/grantflow"
  cp frontends/grantflow-ui/index.html "$WEBROOT/grantflow/"
  cp frontends/grantflow-ui/styles.css "$WEBROOT/grantflow/"
  cp frontends/grantflow-ui/app.js "$WEBROOT/grantflow/"
fi

echo "  ✓ All frontends deployed"

# ──────────────────────────────────────────────────────────────────────────────
#  PHASE 7: Configure Nginx
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "▶ [PHASE 7] Configuring Nginx..."

NGINX_CONF="/etc/nginx/sites-available/extropyengine.com"

if [ -f "$NGINX_CONF" ]; then
  # Check if grantflow routes already exist
  if grep -q "grantflow-discovery" "$NGINX_CONF" 2>/dev/null; then
    echo "  GrantFlow Nginx routes already configured"
  else
    echo "  Adding GrantFlow API proxy routes..."
    cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%s)"

    # Find the last } and insert before it
    LAST_BRACE=$(grep -n "}" "$NGINX_CONF" | tail -1 | cut -d: -f1)
    if [ -n "$LAST_BRACE" ]; then
      head -n $((LAST_BRACE - 1)) "$NGINX_CONF" > /tmp/nginx-new.conf
      cat >> /tmp/nginx-new.conf << 'NGINX_ROUTES'

    # ── GrantFlow Discovery API ──────────────────────────────────
    location /grantflow/api/ {
        proxy_pass http://127.0.0.1:4020/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /grantflow/health {
        proxy_pass http://127.0.0.1:4020/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # ── GrantFlow Proposer API ───────────────────────────────────
    location /proposer/api/ {
        proxy_pass http://127.0.0.1:4021/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /proposer/health {
        proxy_pass http://127.0.0.1:4021/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # ── Academia Bridge API ──────────────────────────────────────
    location /academia/api/ {
        proxy_pass http://127.0.0.1:4022/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /academia/health {
        proxy_pass http://127.0.0.1:4022/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # ── Character Sheet ──────────────────────────────────────────
    location /character-sheet/ {
        alias /var/www/extropyengine.com/character-sheet/;
        try_files $uri $uri/ /character-sheet/index.html;
    }
NGINX_ROUTES
      tail -n +"$LAST_BRACE" "$NGINX_CONF" >> /tmp/nginx-new.conf
      cp /tmp/nginx-new.conf "$NGINX_CONF"
      echo "  ✓ Nginx routes added"
    fi
  fi

  # Test and reload nginx
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "  ✓ Nginx reloaded"
  else
    echo "  ⚠ Nginx config test failed — check manually with: nginx -t"
  fi
else
  echo "  ⚠ Nginx config not found at $NGINX_CONF"
fi

# ──────────────────────────────────────────────────────────────────────────────
#  PHASE 8: Health checks
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "▶ [PHASE 8] Running health checks..."
echo ""

SERVICES=(
  "postgres:5432"
  "redis:6379"
  "epistemology-engine:4001"
  "signalflow:4002"
  "loop-ledger:4003"
  "reputation:4004"
  "xp-mint:4005"
  "homeflow:4015"
  "grantflow-discovery:4020"
  "grantflow-proposer:4021"
  "academia-bridge:4022"
)

for SVC in "${SERVICES[@]}"; do
  NAME="${SVC%%:*}"
  PORT="${SVC##*:}"
  printf "  %-24s (port %s): " "$NAME" "$PORT"

  if [ "$NAME" = "postgres" ]; then
    if docker compose exec -T postgres pg_isready -U extropy > /dev/null 2>&1; then
      echo "✓ healthy"
    else
      echo "✗ down"
    fi
  elif [ "$NAME" = "redis" ]; then
    if docker compose exec -T redis redis-cli ping > /dev/null 2>&1; then
      echo "✓ healthy"
    else
      echo "✗ down"
    fi
  else
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/health" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
      echo "✓ healthy"
    else
      echo "✗ (HTTP ${HTTP_CODE})"
    fi
  fi
done

# ──────────────────────────────────────────────────────────────────────────────
#  SUMMARY
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  DEPLOYMENT COMPLETE — $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  🌐 Frontends:"
echo "     https://extropyengine.com/                  → Dashboard"
echo "     https://extropyengine.com/homeflow/         → HomeFlow"
echo "     https://extropyengine.com/grantflow/        → GrantFlow UI"
echo "     https://extropyengine.com/character-sheet/  → Character Sheet"
echo ""
echo "  🔧 Backend APIs:"
echo "     https://extropyengine.com/api/              → Epistemology Engine"
echo "     https://extropyengine.com/grantflow/api/v1/ → GrantFlow Discovery"
echo "     https://extropyengine.com/proposer/api/v1/  → GrantFlow Proposer"
echo "     https://extropyengine.com/academia/api/v1/  → Academia Bridge"
echo ""
echo "  📋 Quick commands:"
echo "     docker compose -f docker-compose.yml -f docker-compose.grantflow.yml logs -f"
echo "     docker compose -f docker-compose.yml -f docker-compose.grantflow.yml ps"
echo "     nano /root/extropy-engine/.env  ← fill in credentials"
echo ""
echo "  ⚡ To enable auto-uploads, edit .env and add:"
echo "     ACADEMIA_EMAIL=your@email.com"
echo "     ACADEMIA_PASSWORD=your_password"
echo ""
echo "═══════════════════════════════════════════════════════════════"
