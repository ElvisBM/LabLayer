#!/bin/bash
set -euo pipefail
app=/var/www/lablayer/app
release=$(pwd)
release_id=$(basename "$release")
backup="$HOME/deploy-backups/$release_id"
listing_bundle=MarketplaceListings-VddeGlgY.js
app_styles=index-DWgqqtQi.css
cd "$app"
sha256sum --check "$release/baseline"
mkdir -p "$backup"
install -m 644 server/marketplace-drafts.ts "$backup/marketplace-drafts.ts"
install -m 644 shared/marketplaces/drafts.ts "$backup/drafts.ts"
install -m 644 dist/index.html "$backup/index.html"
install -m 644 "dist/assets/$listing_bundle" "$backup/$listing_bundle"
install -m 644 "dist/assets/$app_styles" "$backup/$app_styles"
rollback() {
  install -m 644 "$backup/marketplace-drafts.ts" "$app/server/marketplace-drafts.ts"
  install -m 644 "$backup/drafts.ts" "$app/shared/marketplaces/drafts.ts"
  install -m 644 "$backup/index.html" "$app/dist/index.html"
  install -m 644 "$backup/$listing_bundle" "$app/dist/assets/$listing_bundle"
  install -m 644 "$backup/$app_styles" "$app/dist/assets/$app_styles"
  pm2 restart lablayer-app >/dev/null || true
}
trap rollback ERR
for path in server/marketplace-drafts.ts shared/marketplaces/drafts.ts "dist/assets/$listing_bundle" "dist/assets/$app_styles" dist/index.html; do
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
for path in server/marketplace-drafts.ts shared/marketplaces/drafts.ts "dist/assets/$listing_bundle" "dist/assets/$app_styles" dist/index.html; do
  cmp -s "$release/$path" "$app/$path"
done
sha256sum "$app/server/marketplace-drafts.ts" "$app/shared/marketplaces/drafts.ts" "$app/dist/assets/$listing_bundle" "$app/dist/assets/$app_styles" "$app/dist/index.html"
trap - ERR
