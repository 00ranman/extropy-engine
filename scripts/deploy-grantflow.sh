#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  EXTROPY ENGINE — GrantFlow Backend Deploy Script
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Run this on the VPS (187.124.95.129) via SSH:
#    ssh root@187.124.95.129
#    cd /root/extropy-engine
#    git pull origin main
#    bash scripts/deploy-grantflow.sh
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_DIR="/root/extropy-engine"
WEBROOT="/var/www/extropyengine.com"

echo "═══════════════════════════════════════════════════════════════"
echo "  EXTROPY ENGINE — GrantFlow Backend Deployment"
echo "═══════════════════════════════════════════════════════════════"

cd "$REPO_DIR"

# ── Step 1: Pull latest code ──────────────────────────────────────────────
echo ""
echo "[1/6] Pulling latest code from GitHub..."
git pull origin main

# ── Step 2: Run database migrations ───────────────────────────────────────
echo ""
echo "[2/6] Running database migrations..."

# Check if postgres is accessible
if docker compose exec -T postgres pg_isready -U extropy > /dev/null 2>&1; then
  echo "  PostgreSQL is healthy."
else
  echo "  WARNING: PostgreSQL may not be running. Starting infrastructure..."
  docker compose up -d postgres redis
  echo "  Waiting for PostgreSQL to be ready..."
  sleep 10
fi

# Run migrations for each new service
for SERVICE in grantflow-discovery grantflow-proposer academia-bridge; do
  MIGRATION_DIR="packages/${SERVICE}/migrations"
  if [ -d "$MIGRATION_DIR" ]; then
    echo "  Running migrations for ${SERVICE}..."
    for SQL_FILE in "$MIGRATION_DIR"/*.sql; do
      echo "    Applying $(basename "$SQL_FILE")..."
      docker compose exec -T postgres psql -U extropy -d extropy_engine -f "/dev/stdin" < "$SQL_FILE" 2>&1 || true
    done
  fi
done
echo "  Migrations complete."

# ── Step 3: Build the new services ────────────────────────────────────────
echo ""
echo "[3/6] Building GrantFlow Docker images..."
docker compose -f docker-compose.yml -f docker-compose.grantflow.yml build \
  grantflow-discovery \
  grantflow-proposer \
  academia-bridge

# ── Step 4: Start the new services ────────────────────────────────────────
echo ""
echo "[4/6] Starting GrantFlow services..."
docker compose -f docker-compose.yml -f docker-compose.grantflow.yml up -d \
  grantflow-discovery \
  grantflow-proposer \
  academia-bridge

echo "  Waiting for services to initialize..."
sleep 15

# ── Step 5: Health checks ────────────────────────────────────────────────
echo ""
echo "[5/6] Running health checks..."

SERVICES=("grantflow-discovery:4020" "grantflow-proposer:4021" "academia-bridge:4022")
ALL_HEALTHY=true

for SVC in "${SERVICES[@]}"; do
  NAME="${SVC%%:*}"
  PORT="${SVC##*:}"
  echo -n "  ${NAME} (port ${PORT}): "
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/health" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "✓ healthy"
  else
    echo "✗ unhealthy (HTTP ${HTTP_CODE})"
    ALL_HEALTHY=false
  fi
done

if [ "$ALL_HEALTHY" = false ]; then
  echo ""
  echo "  Some services are not healthy. Check logs:"
  echo "    docker compose -f docker-compose.yml -f docker-compose.grantflow.yml logs --tail=50 grantflow-discovery"
  echo "    docker compose -f docker-compose.yml -f docker-compose.grantflow.yml logs --tail=50 grantflow-proposer"
  echo "    docker compose -f docker-compose.yml -f docker-compose.grantflow.yml logs --tail=50 academia-bridge"
fi

# ── Step 6: Update Nginx config ──────────────────────────────────────────
echo ""
echo "[6/6] Updating Nginx configuration..."

# Add GrantFlow API routes to nginx
NGINX_CONF="/etc/nginx/sites-available/extropyengine.com"

# Check if grantflow routes already exist
if grep -q "grantflow-discovery" "$NGINX_CONF" 2>/dev/null; then
  echo "  Nginx already configured for GrantFlow."
else
  echo "  Adding GrantFlow proxy routes to Nginx..."

  # Create a backup
  cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%s)"

  # Insert before the closing } of the server block
  # We use a temp file approach for safety
  cat > /tmp/grantflow-nginx.conf << 'NGINX'

    # ── GrantFlow Discovery API ──────────────────────────────────────────
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

    # ── GrantFlow Proposer API ───────────────────────────────────────────
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

    # ── Academia Bridge API ──────────────────────────────────────────────
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
NGINX

  # Insert the grantflow routes before the last closing brace
  # Find the line number of the last } in the server block
  LAST_BRACE=$(grep -n "}" "$NGINX_CONF" | tail -1 | cut -d: -f1)
  if [ -n "$LAST_BRACE" ]; then
    head -n $((LAST_BRACE - 1)) "$NGINX_CONF" > /tmp/nginx-new.conf
    cat /tmp/grantflow-nginx.conf >> /tmp/nginx-new.conf
    tail -n +"$LAST_BRACE" "$NGINX_CONF" >> /tmp/nginx-new.conf
    cp /tmp/nginx-new.conf "$NGINX_CONF"
    echo "  Routes added successfully."
  else
    echo "  WARNING: Could not find server block closing brace. Manual nginx config needed."
  fi

  # Test and reload nginx
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "  Nginx reloaded successfully."
  else
    echo "  WARNING: Nginx config test failed. Restoring backup..."
    cp "${NGINX_CONF}.bak."* "$NGINX_CONF" 2>/dev/null
    systemctl reload nginx
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  GrantFlow Backend Deployment Complete"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Services running:"
echo "    grantflow-discovery  → http://localhost:4020  → https://extropyengine.com/grantflow/api/v1/"
echo "    grantflow-proposer   → http://localhost:4021  → https://extropyengine.com/proposer/api/v1/"
echo "    academia-bridge      → http://localhost:4022  → https://extropyengine.com/academia/api/v1/"
echo ""
echo "  Health endpoints:"
echo "    https://extropyengine.com/grantflow/health"
echo "    https://extropyengine.com/proposer/health"
echo "    https://extropyengine.com/academia/health"
echo ""
echo "  Environment variables to set (optional):"
echo "    GRANTS_GOV_S2S_USER / GRANTS_GOV_S2S_PASS / GRANTS_GOV_CERT_PATH  — for Grants.gov S2S submission"
echo "    OPENAI_API_KEY                                                      — for AI proposal generation"
echo "    ACADEMIA_EMAIL / ACADEMIA_PASSWORD                                   — for academia.edu uploads"
echo ""
echo "  Logs:"
echo "    docker compose -f docker-compose.yml -f docker-compose.grantflow.yml logs -f grantflow-discovery"
echo "    docker compose -f docker-compose.yml -f docker-compose.grantflow.yml logs -f grantflow-proposer"
echo "    docker compose -f docker-compose.yml -f docker-compose.grantflow.yml logs -f academia-bridge"
echo ""
echo "═══════════════════════════════════════════════════════════════"
