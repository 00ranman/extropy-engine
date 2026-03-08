#!/bin/bash
# ============================================
# Extropy Engine — Deploy All Frontends
# Run on VPS: bash scripts/deploy-frontends.sh
# ============================================
set -e

echo "╔══════════════════════════════════════════════════════╗"
echo "║  EXTROPY ENGINE — Frontend Deployment                ║"
echo "║  HomeFlow UI + Character Sheet + GrantFlow           ║"
echo "╚══════════════════════════════════════════════════════╝"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEBROOT="/var/www/extropyengine.com"

# ─── 1. Pull latest from repo ───
echo ""
echo "[1/4] Pulling latest code..."
cd "$REPO_DIR"
git pull origin main 2>/dev/null || echo "  (already up to date)"

# ─── 2. Copy frontend files ───
echo "[2/4] Deploying frontend files..."

# HomeFlow UI
mkdir -p "$WEBROOT/homeflow-ui"
cp -v "$REPO_DIR/frontends/homeflow-ui/"* "$WEBROOT/homeflow-ui/"
echo "  ✓ HomeFlow UI deployed"

# Character Sheet
mkdir -p "$WEBROOT/character-sheet"
cp -v "$REPO_DIR/frontends/character-sheet/"* "$WEBROOT/character-sheet/"
echo "  ✓ Character Sheet deployed"

# GrantFlow UI
mkdir -p "$WEBROOT/grantflow-ui"
cp -v "$REPO_DIR/frontends/grantflow-ui/"* "$WEBROOT/grantflow-ui/"
echo "  ✓ GrantFlow deployed"

# ─── 3. Update Nginx ───
echo "[3/4] Updating Nginx configuration..."

# Backup
cp /etc/nginx/sites-enabled/extropyengine.com \
   /etc/nginx/sites-enabled/extropyengine.com.bak.$(date +%s) 2>/dev/null || true

cat > /etc/nginx/sites-enabled/extropyengine.com << 'NGINX_CONF'
server {
    listen 80;
    server_name extropyengine.com www.extropyengine.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name extropyengine.com www.extropyengine.com;

    ssl_certificate /etc/letsencrypt/live/extropyengine.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/extropyengine.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    root /var/www/extropyengine.com;
    index index.html;

    # ─── Main Dashboard ───
    location / {
        try_files $uri $uri/ /index.html;
    }

    # ─── Character Sheet ───
    location /character-sheet/ {
        alias /var/www/extropyengine.com/character-sheet/;
        try_files $uri $uri/ /character-sheet/index.html;
    }

    # ─── HomeFlow: serve static UI first, fall through to API ───
    location /homeflow/ {
        alias /var/www/extropyengine.com/homeflow-ui/;
        try_files $uri $uri/ @homeflow_api;
    }

    location @homeflow_api {
        proxy_pass http://127.0.0.1:4015;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # ─── HomeFlow API (explicit routes) ───
    location /homeflow/api/ {
        proxy_pass http://127.0.0.1:4015/homeflow/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /homeflow/health {
        proxy_pass http://127.0.0.1:4015/homeflow/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # ─── GrantFlow: static UI ───
    location /grantflow/ {
        alias /var/www/extropyengine.com/grantflow-ui/;
        try_files $uri $uri/ /grantflow-ui/index.html;
    }

    # ─── Core API ───
    location /api/ {
        proxy_pass http://127.0.0.1:4001/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ─── Microservice Routes ───
    location /epistemology/ {
        proxy_pass http://127.0.0.1:4001/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /signalflow/ {
        proxy_pass http://127.0.0.1:4002/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /ledger/ {
        proxy_pass http://127.0.0.1:4003/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /reputation/ {
        proxy_pass http://127.0.0.1:4004/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /mint/ {
        proxy_pass http://127.0.0.1:4005/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # ─── Health ───
    location /health {
        proxy_pass http://127.0.0.1:4001/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # ─── Static caching ───
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
NGINX_CONF

echo "  ✓ Nginx config written"

# ─── 4. Test and reload ───
echo "[4/4] Testing and reloading Nginx..."
nginx -t && systemctl reload nginx
echo "  ✓ Nginx reloaded"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✓ ALL FRONTENDS DEPLOYED                           ║"
echo "║                                                      ║"
echo "║  Live Routes:                                        ║"
echo "║  → https://extropyengine.com/             Dashboard  ║"
echo "║  → https://extropyengine.com/homeflow/    HomeFlow   ║"
echo "║  → https://extropyengine.com/grantflow/   GrantFlow  ║"
echo "║  → https://extropyengine.com/character-sheet/ XP     ║"
echo "║                                                      ║"
echo "║  Welcome to the Extropy Engine. The game is live.    ║"
echo "╚══════════════════════════════════════════════════════╝"
