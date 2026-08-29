#!/usr/bin/env bash
# HomeFlow VPS Deploy Script
# Idempotent. Safe to run multiple times. Will not touch existing extropyengine.com or lladnaros.com nginx configs.
#
# Run on srv1470690.hstgr.cloud as root (or with sudo).
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/00ranman/extropy-engine/main/scripts/deploy-homeflow.sh | sudo bash
# Or paste the contents into a file and run: sudo bash deploy-homeflow.sh

set -euo pipefail

DOMAIN="homeflow.extropyengine.com"
APP_USER="homeflow"
APP_DIR="/opt/homeflow"
REPO_URL="https://github.com/00ranman/extropy-engine.git"
APP_PORT="4001"
TEMPORAL_PORT="4002"
TEMPORAL_DATA_DIR="/var/lib/temporal"
PG_DB="homeflow"
PG_USER="homeflow"

log() { echo -e "\033[1;36m[homeflow]\033[0m $*"; }
err() { echo -e "\033[1;31m[error]\033[0m $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || err "Run as root. Try: sudo bash $0"

#####################################################
# 1. System packages
#####################################################
log "Installing system dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl ca-certificates gnupg lsb-release \
  git build-essential \
  postgresql postgresql-contrib \
  nginx \
  ufw \
  certbot python3-certbot-nginx \
  jq

#####################################################
# 2. Node 20 via NodeSource
#####################################################
if ! command -v node >/dev/null || ! node --version | grep -q '^v20'; then
  log "Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

#####################################################
# 3. pnpm
#####################################################
if ! command -v pnpm >/dev/null; then
  log "Installing pnpm 9"
  npm install -g pnpm@9
fi

#####################################################
# 4. App user
#####################################################
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Creating app user: $APP_USER"
  useradd --system --create-home --home-dir "/home/$APP_USER" --shell /bin/bash "$APP_USER"
fi

#####################################################
# 5. Repo clone or pull
#####################################################
if [[ ! -d "$APP_DIR/.git" ]]; then
  log "Cloning repo into $APP_DIR"
  mkdir -p "$APP_DIR"
  chown "$APP_USER:$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
else
  log "Repo exists, pulling latest main"
  sudo -u "$APP_USER" -- bash -c "cd '$APP_DIR' && git fetch origin main && git reset --hard origin/main"
fi

#####################################################
# 6. Install + build
#####################################################
log "Installing pnpm deps and building monorepo"
sudo -u "$APP_USER" -- bash -c "cd '$APP_DIR' && pnpm install --frozen-lockfile && pnpm -r --if-present run build"

#####################################################
# 7. Postgres (default OFF; set ENABLE_POSTGRES=1 to provision)
#####################################################
if [[ "${ENABLE_POSTGRES:-0}" == "1" ]]; then
  log "Configuring Postgres (ENABLE_POSTGRES=1)"
  systemctl enable --now postgresql

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$PG_USER'" | grep -q 1; then
    PG_PASS=$(openssl rand -hex 24)
    sudo -u postgres psql -c "CREATE ROLE $PG_USER LOGIN PASSWORD '$PG_PASS';"
    echo "$PG_PASS" > "/root/.homeflow_pg_password"
    chmod 600 "/root/.homeflow_pg_password"
    log "Postgres password generated and saved to /root/.homeflow_pg_password"
  else
    PG_PASS=$(cat /root/.homeflow_pg_password 2>/dev/null || echo "")
    [[ -n "$PG_PASS" ]] || err "Postgres role exists but password file missing. Recreate manually."
    log "Reusing existing Postgres role"
  fi

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$PG_DB'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE DATABASE $PG_DB OWNER $PG_USER;"
  fi
else
  log "Skipping Postgres (default). Family pilot uses file-backed store at /var/lib/homeflow."
  mkdir -p /var/lib/homeflow
  chown "$APP_USER:$APP_USER" /var/lib/homeflow
fi

#####################################################
# 7a. Redis (default OFF; set ENABLE_REDIS=1 to require)
#####################################################
if [[ "${ENABLE_REDIS:-0}" == "1" ]]; then
  log "Checking Redis (ENABLE_REDIS=1)"
  REDIS_HOST_PORT="${REDIS_URL:-redis://127.0.0.1:6379}"
  REDIS_HOST=$(echo "$REDIS_HOST_PORT" | sed -E 's#^redis://([^:/]+).*#\1#')
  REDIS_PORT=$(echo "$REDIS_HOST_PORT" | sed -E 's#^redis://[^:/]+:?([0-9]+)?.*#\1#')
  REDIS_PORT="${REDIS_PORT:-6379}"
  if (echo > "/dev/tcp/$REDIS_HOST/$REDIS_PORT") 2>/dev/null; then
    log "Redis reachable at $REDIS_HOST:$REDIS_PORT"
  else
    log "WARNING: ENABLE_REDIS=1 but $REDIS_HOST:$REDIS_PORT is not reachable. HomeFlow will fall back to the in process bus and log a warning at boot. Provision Redis (or unset ENABLE_REDIS) before relying on cross process pub/sub."
  fi
else
  log "Skipping Redis (default). HomeFlow will use the in process event bus."
fi

#####################################################
# 7b. Temporal data directory (Universal Times service)
#####################################################
log "Ensuring temporal data dir at $TEMPORAL_DATA_DIR"
mkdir -p "$TEMPORAL_DATA_DIR"
chown "$APP_USER:$APP_USER" "$TEMPORAL_DATA_DIR"

#####################################################
# 8. .env file (idempotent: only writes if missing)
#####################################################
ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Generating $ENV_FILE skeleton"
  SESSION_SECRET=$(openssl rand -hex 32)
  if [[ "${ENABLE_POSTGRES:-0}" == "1" ]]; then
    DB_LINE="DATABASE_URL=postgres://$PG_USER:$PG_PASS@127.0.0.1:5432/$PG_DB"
  else
    DB_LINE="# DATABASE_URL unset, file-backed store active\nHOMEFLOW_DATA_DIR=/var/lib/homeflow"
  fi
  TEMPORAL_HMAC_SECRET=$(openssl rand -hex 32)
  cat > "$ENV_FILE" <<EOF
# HomeFlow production env, do not commit
PORT=$APP_PORT
BASE_URL=https://$DOMAIN
SESSION_SECRET=$SESSION_SECRET
$(printf '%b' "$DB_LINE")
SECURE_COOKIES=true

# Universal Times service (runs alongside HomeFlow on the same VPS)
TEMPORAL_URL=http://127.0.0.1:$TEMPORAL_PORT
TEMPORAL_HMAC_SECRET=$TEMPORAL_HMAC_SECRET

# Event bus. Default: in process EventEmitter (family pilot). Set both to
# enable a Redis backed bus across multiple HomeFlow processes.
# ENABLE_REDIS=1
# REDIS_URL=redis://127.0.0.1:6379

# Fill these in after creating Google OAuth client (see post-deploy notes)
GOOGLE_CLIENT_ID=PASTE_HERE
GOOGLE_CLIENT_SECRET=PASTE_HERE
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  log ".env exists, leaving as-is"
  # Ensure TEMPORAL_URL is present (idempotent backfill for older .env files).
  if ! grep -q '^TEMPORAL_URL=' "$ENV_FILE"; then
    echo "TEMPORAL_URL=http://127.0.0.1:$TEMPORAL_PORT" >> "$ENV_FILE"
  fi
fi

#####################################################
# 8b. .env.temporal for the Universal Times service
#####################################################
TEMPORAL_ENV_FILE="$APP_DIR/.env.temporal"
if [[ ! -f "$TEMPORAL_ENV_FILE" ]]; then
  log "Generating $TEMPORAL_ENV_FILE"
  TEMPORAL_HMAC_SECRET_VAL=$(grep -E '^TEMPORAL_HMAC_SECRET=' "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)
  if [[ -z "$TEMPORAL_HMAC_SECRET_VAL" ]]; then
    TEMPORAL_HMAC_SECRET_VAL=$(openssl rand -hex 32)
    echo "TEMPORAL_HMAC_SECRET=$TEMPORAL_HMAC_SECRET_VAL" >> "$ENV_FILE"
  fi
  cat > "$TEMPORAL_ENV_FILE" <<EOF
# Temporal (Universal Times) service env, do not commit
TEMPORAL_PORT=$TEMPORAL_PORT
TEMPORAL_DATA_DIR=$TEMPORAL_DATA_DIR
TEMPORAL_VERSION=0.1.0
EOF
  chown "$APP_USER:$APP_USER" "$TEMPORAL_ENV_FILE"
  chmod 600 "$TEMPORAL_ENV_FILE"
else
  log ".env.temporal exists, leaving as-is"
fi

#####################################################
# 9. systemd service
#####################################################
SERVICE_FILE="/etc/systemd/system/homeflow.service"
log "Writing systemd unit at $SERVICE_FILE"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=HomeFlow Family Pilot (Extropy Engine)
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/pnpm --filter @extropy/homeflow run start
Restart=always
RestartSec=5
StandardOutput=append:/var/log/homeflow.log
StandardError=append:/var/log/homeflow.log

[Install]
WantedBy=multi-user.target
EOF

touch /var/log/homeflow.log
chown "$APP_USER:$APP_USER" /var/log/homeflow.log

TEMPORAL_SERVICE_FILE="/etc/systemd/system/temporal.service"
log "Writing systemd unit at $TEMPORAL_SERVICE_FILE"
cat > "$TEMPORAL_SERVICE_FILE" <<EOF
[Unit]
Description=Temporal (Universal Times) service for Extropy Engine
After=network.target
Before=homeflow.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env.temporal
ExecStart=/usr/bin/pnpm --filter @extropy/temporal-service run start
Restart=always
RestartSec=5
StandardOutput=append:/var/log/temporal.log
StandardError=append:/var/log/temporal.log

[Install]
WantedBy=multi-user.target
EOF

touch /var/log/temporal.log
chown "$APP_USER:$APP_USER" /var/log/temporal.log

systemctl daemon-reload
systemctl enable homeflow temporal

#####################################################
# 10. Nginx site (only adds; never touches existing extropyengine.com or lladnaros.com configs)
#####################################################
NGINX_SITE="/etc/nginx/sites-available/$DOMAIN"
NGINX_LINK="/etc/nginx/sites-enabled/$DOMAIN"

mkdir -p /var/www/certbot

# Decide whether to emit an HTTPS server block.
# If the cert files already exist (re-run after certbot), include both 80 + 443.
# If not (first run, before certbot), emit only port 80 so nginx can start.
HAS_CERT="no"
if [[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" && -f "/etc/letsencrypt/live/$DOMAIN/privkey.pem" ]]; then
  HAS_CERT="yes"
fi

log "Writing nginx site config at $NGINX_SITE (HTTPS block: $HAS_CERT)"

if [[ "$HAS_CERT" == "yes" ]]; then
  cat > "$NGINX_SITE" <<EOF
# Generated by deploy-homeflow.sh, do not edit by hand
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        try_files \$uri =404;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;
    add_header Service-Worker-Allowed "/" always;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
EOF
else
  cat > "$NGINX_SITE" <<EOF
# Generated by deploy-homeflow.sh, do not edit by hand
# HTTP-only stage. certbot --nginx will rewrite this to add HTTPS.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        try_files \$uri =404;
    }

    add_header Service-Worker-Allowed "/" always;
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
EOF
fi

[[ -L "$NGINX_LINK" ]] || ln -s "$NGINX_SITE" "$NGINX_LINK"

# Validate and reload nginx now so the HTTP site is live for the certbot challenge.
if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx
  log "nginx reloaded with HomeFlow site"
else
  err "nginx -t failed. Check: nginx -t"
fi

#####################################################
# 11. UFW firewall (only adds, never strips)
#####################################################
if command -v ufw >/dev/null; then
  ufw allow 'Nginx Full' >/dev/null 2>&1 || true
  ufw allow OpenSSH >/dev/null 2>&1 || true
fi

#####################################################
# 12. Output next steps
#####################################################
cat <<EOF

==================================================================
  HomeFlow VPS provisioning complete.
==================================================================

NEXT STEPS (these still need to be done by you, in this order):

1) DNS (do this FIRST):
   Add an A record at Hostinger:
     Name:  homeflow
     Type:  A
     Value: 187.124.95.129
     TTL:   300 or default

   Then on this VPS, wait until this command prints 187.124.95.129:
     dig +short homeflow.extropyengine.com @8.8.8.8

2) SSL cert (only AFTER dig returns the IP above):
     certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m randall@extropyengine.com --redirect

3) Google OAuth client:
   Authorized JavaScript origins:  https://$DOMAIN
   Authorized redirect URIs:       https://$DOMAIN/auth/google/callback

   Then paste the Client ID and Client Secret into:
     $ENV_FILE
   (the file already has placeholder lines)

4) Start the services:
     systemctl restart temporal homeflow
     systemctl status temporal --no-pager
     systemctl status homeflow --no-pager
     journalctl -u temporal -n 30 --no-pager
     journalctl -u homeflow -n 50 --no-pager

5) Sanity check the Universal Times service:
     curl -s http://127.0.0.1:$TEMPORAL_PORT/health
     curl -s http://127.0.0.1:$TEMPORAL_PORT/now | head -20

6) Open https://$DOMAIN/ in a browser. Sign in with Google. Family pilot is live.
   Season transitions will fire from the temporal service into HomeFlow's
   /temporal/event endpoint automatically once both services are up.

OPTIONAL: graduate beyond the family pilot defaults
   * Postgres: rerun this script with ENABLE_POSTGRES=1 to provision Postgres
     and rewrite the .env DATABASE_URL line.
   * Redis: rerun with ENABLE_REDIS=1 (and provide a reachable REDIS_URL in
     the .env) to use a Redis backed event bus across multiple HomeFlow
     processes. The default in process bus is the right choice for a single
     family pilot node.

To redeploy after future code updates, just run this script again.

EOF
