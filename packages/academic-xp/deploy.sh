#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AcademicXP — Deploy from Git
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_ROOT="/opt/extropy-engine"
DIST_SRC="$REPO_ROOT/packages/academic-xp/dist"
NGINX_CONF="/etc/nginx/sites-available/extropyengine.com"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  AcademicXP — Deploy from Git"
echo "  $(date)"
echo "═══════════════════════════════════════════════════════════════"

# ── 1. Verify dist exists ──────────────────────────────────────────
echo ""
echo "[1/3] Verifying build..."
if [ ! -f "$DIST_SRC/index.html" ]; then
  echo "  ✗ No index.html at $DIST_SRC"
  echo "  Make sure you pulled the feature/academic-xp branch."
  exit 1
fi
echo "  ✓ index.html found"
ls -la "$DIST_SRC/"

# ── 2. Update Nginx ────────────────────────────────────────────────
echo ""
echo "[2/3] Updating Nginx..."

if grep -q "location /academic" "$NGINX_CONF" 2>/dev/null; then
  echo "  AcademicXP routes already in Nginx. Skipping."
else
  python3 << 'PYEOF'
import sys

nginx_conf = "/etc/nginx/sites-available/extropyengine.com"

block = """
    # ── AcademicXP SPA ────────────────────────────────────────
    location /academic {
        alias /opt/extropy-engine/packages/academic-xp/dist;
        index index.html;
        try_files $uri $uri/ /academic/index.html;
    }

    location /academic/assets/ {
        alias /opt/extropy-engine/packages/academic-xp/dist/assets/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # ── AcademicXP API proxies ────────────────────────────────
    location /api/manuscripts {
        proxy_pass http://epistemology/claims;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50m;
    }

    location /api/claims {
        proxy_pass http://epistemology/claims;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50m;
    }

    location /api/validations {
        proxy_pass http://signalflow/validations;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~ ^/api/xp/(.+)$ {
        proxy_pass http://xp_mint/xp/$1;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/leaderboard {
        proxy_pass http://127.0.0.1:4013/leaderboard;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
"""

with open(nginx_conf, "r") as f:
    content = f.read()

# Insert before "Static dashboard fallback" comment or "location / {"
if "Static dashboard fallback" in content:
    content = content.replace("# ── Static dashboard fallback", block + "\n    # ── Static dashboard fallback")
elif "location / {" in content:
    idx = content.rfind("location / {")
    if idx > 0:
        content = content[:idx] + block + "\n    " + content[idx:]
else:
    idx = content.rfind("}")
    if idx > 0:
        content = content[:idx] + block + "\n" + content[idx:]

with open(nginx_conf, "w") as f:
    f.write(content)

print("  ✓ Nginx config updated")
PYEOF
fi

nginx -t && systemctl reload nginx
echo "  ✓ Nginx reloaded"

# ── 3. Verify ──────────────────────────────────────────────────────
echo ""
echo "[3/3] Verifying..."
[ -f "$DIST_SRC/index.html" ] && echo "  ✓ index.html" || echo "  ✗ index.html missing"
[ -d "$DIST_SRC/assets" ] && echo "  ✓ assets/" || echo "  ✗ assets/ missing"

HTTP_CODE=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1/academic 2>/dev/null || echo "err")
echo "  HTTP /academic → $HTTP_CODE"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ AcademicXP DEPLOYED"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  https://extropyengine.com/academic"
echo "  https://extropyengine.com/academic/#/dashboard"
echo "  https://extropyengine.com/academic/#/leaderboard"
echo "  https://extropyengine.com/academic/#/credentials"
echo "  https://extropyengine.com/academic/#/manuscript/ms-001"
echo ""
