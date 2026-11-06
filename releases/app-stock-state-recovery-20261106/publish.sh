#!/bin/bash
set -euo pipefail
app=/var/www/lablayer/app
release=$(pwd)
release_id=$(basename "$release")
backup="$HOME/deploy-backups/$release_id"
cd "$app"
sha256sum --check "$release/baseline"
mkdir -p "$backup"
install -m 644 server/marketplace-drafts.ts "$backup/marketplace-drafts.ts"
install -m 644 dist/index.html "$backup/index.html"
rollback() {
  install -m 644 "$backup/marketplace-drafts.ts" "$app/server/marketplace-drafts.ts"
  install -m 644 "$backup/index.html" "$app/dist/index.html"
  pm2 restart lablayer-app >/dev/null || true
}
trap rollback ERR
install -m 644 "$release/server/marketplace-drafts.ts" "$app/server/marketplace-drafts.ts.next"
mv "$app/server/marketplace-drafts.ts.next" "$app/server/marketplace-drafts.ts"
for asset in "$release"/dist/assets/*; do
  install -m 644 "$asset" "$app/dist/assets/$(basename "$asset").next"
  mv "$app/dist/assets/$(basename "$asset").next" "$app/dist/assets/$(basename "$asset")"
done
install -m 644 "$release/dist/index.html" "$app/dist/index.html.next"
mv "$app/dist/index.html.next" "$app/dist/index.html"
pm2 restart lablayer-app >/dev/null
ready=false
for i in {1..60}; do
  if curl --max-time 3 -fsS http://localhost:3000/api/health 2>/dev/null | grep -q '"ok"'; then ready=true; break; fi
  sleep 1
done
$ready
cmp -s "$release/server/marketplace-drafts.ts" "$app/server/marketplace-drafts.ts"
cmp -s "$release/dist/index.html" "$app/dist/index.html"
sha256sum "$app/server/marketplace-drafts.ts" "$app/dist/index.html"
trap - ERR
