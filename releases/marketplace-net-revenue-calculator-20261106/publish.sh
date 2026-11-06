#!/bin/bash
set -euo pipefail
app=/var/www/lablayer/app
release=$(pwd)
release_id=$(basename "$release")
backup="$HOME/deploy-backups/$release_id"
asset=MarketplaceListings-VddeGlgY.js
cd "$app"
sha256sum --check "$release/baseline"
mkdir -p "$backup"
install -m 644 server/marketplace-drafts.ts "$backup/marketplace-drafts.ts"
install -m 644 shared/marketplaces/drafts.ts "$backup/drafts.ts"
install -m 644 dist/index.html "$backup/index.html"
install -m 644 "dist/assets/$asset" "$backup/$asset"
rollback() {
  install -m 644 "$backup/marketplace-drafts.ts" "$app/server/marketplace-drafts.ts"
  install -m 644 "$backup/drafts.ts" "$app/shared/marketplaces/drafts.ts"
  install -m 644 "$backup/index.html" "$app/dist/index.html"
  install -m 644 "$backup/$asset" "$app/dist/assets/$asset"
  pm2 restart lablayer-app >/dev/null || true
}
trap rollback ERR
for path in server/marketplace-drafts.ts shared/marketplaces/drafts.ts "dist/assets/$asset" dist/index.html; do
  install -m 644 "$release/$path" "$app/$path.next"
  mv "$app/$path.next" "$app/$path"
done
pm2 restart lablayer-app >/dev/null
ready=false
for i in {1..60}; do
  if curl --max-time 3 -fsS http://localhost:3000/api/health 2>/dev/null | grep -q '"ok"'; then ready=true; break; fi
  sleep 1
done
$ready
cmp -s "$release/server/marketplace-drafts.ts" "$app/server/marketplace-drafts.ts"
cmp -s "$release/shared/marketplaces/drafts.ts" "$app/shared/marketplaces/drafts.ts"
cmp -s "$release/dist/assets/$asset" "$app/dist/assets/$asset"
cmp -s "$release/dist/index.html" "$app/dist/index.html"
sha256sum "$app/server/marketplace-drafts.ts" "$app/shared/marketplaces/drafts.ts" "$app/dist/assets/$asset" "$app/dist/index.html"
trap - ERR
