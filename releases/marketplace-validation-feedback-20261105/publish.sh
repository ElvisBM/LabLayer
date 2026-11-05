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
rollback() {
  install -m 644 "$backup/marketplace-drafts.ts" "$app/server/marketplace-drafts.ts"
  pm2 restart lablayer-app >/dev/null
}
trap rollback ERR
install -m 644 "$release/server/marketplace-drafts.ts" "$app/server/marketplace-drafts.ts.next"
mv "$app/server/marketplace-drafts.ts.next" "$app/server/marketplace-drafts.ts"
pm2 restart lablayer-app >/dev/null
ready=false
for i in {1..45}; do
  if curl --max-time 3 -fsS http://localhost:3000/api/health 2>/dev/null | grep -q '"ok"'; then ready=true; break; fi
  sleep 1
done
$ready
cmp -s "$release/server/marketplace-drafts.ts" "$app/server/marketplace-drafts.ts"
sha256sum "$app/server/marketplace-drafts.ts"
trap - ERR
