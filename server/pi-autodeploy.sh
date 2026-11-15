#!/usr/bin/env bash
# 在 roosterpi 上跑（fullcircle-autodeploy.timer 每分钟一次）：GitHub 上 main 有新提交就部署，谁推的都一样。
# 跟 server/deploy.sh 做的事一样，只是文件从 GitHub 的 main 拿，不从谁的电脑上拿。
# 上次部署的提交记在 $DEST/.deployed；Mac 上的 post-commit 钩子照样能立刻部署，这里只在 GitHub 的 main 变了时才动。
set -euo pipefail
DEST=/home/roosterwho/services/fullcircle
REPO=$DEST/repo
URL=https://github.com/realRoosterWho/jiafang-yao-yuan.git
[ -d "$REPO/.git" ] || git clone -q --filter=blob:none --no-checkout "$URL" "$REPO"
cd "$REPO"
git fetch -q origin main
new=$(git rev-parse origin/main)
[ "$new" = "$(cat "$DEST/.deployed" 2>/dev/null || true)" ] && exit 0
echo "=== $(date '+%F %T') 部署 ${new:0:7}"
git -c advice.detachedHead=false checkout -q --force --detach "$new"
install -m 644 server/collector.py server/admin.py server/saves.py server/admin.html "$DEST/"
install -m 644 index.html flow.js "$DEST/public/"
mkdir -p "$DEST/public/assets" && cp -r assets/. "$DEST/public/assets/" && chmod 755 "$DEST/public/assets" && chmod 644 "$DEST/public/assets/"*
sudo -n systemctl restart fullcircle
sleep 1; curl -fsS http://127.0.0.1:2504/healthz >/dev/null
echo "$new" > "$DEST/.deployed"
echo "OK ${new:0:7}"
