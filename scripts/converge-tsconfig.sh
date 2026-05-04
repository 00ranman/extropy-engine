#!/usr/bin/env bash
# Commit A: full tsconfig converge.
# - Every package extends ../../tsconfig.base.json
# - Drops composite project references at root and per-package
# - Adds tsconfig to packages that lack one
# - Cleans stale build artifacts emitted into src/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Canonical per-package tsconfig content
read -r -d '' PKG_TSCONFIG <<'JSON' || true
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/__tests__/**"]
}
JSON

# Packages that have a package.json AND a src/ dir get a converged tsconfig.
# api-gateway has no package.json so we skip it.
shopt -s nullglob
for pkg_dir in packages/*/; do
  pkg=$(basename "$pkg_dir")
  if [ ! -f "$pkg_dir/package.json" ]; then
    echo "skip $pkg (no package.json)"
    continue
  fi
  if [ ! -d "$pkg_dir/src" ]; then
    echo "skip $pkg (no src/)"
    continue
  fi
  printf '%s\n' "$PKG_TSCONFIG" > "$pkg_dir/tsconfig.json"
  echo "wrote $pkg_dir/tsconfig.json"
done
