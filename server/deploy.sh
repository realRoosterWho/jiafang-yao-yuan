#!/usr/bin/env bash
# 把 index.html 和收集服务推到 roosterpi 并重启。数据库（data/）不会被覆盖。
# 游戏只发布 git 里已提交的版本（HEAD），工作区里没提交的改动不会上线。
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${HOST:-roosterpi}
SSH=(ssh); ssh -o ConnectTimeout=8 "$HOST" true 2>/dev/null || SSH=(ssh -o ProxyCommand=none)
DEST=/home/roosterwho/services/fullcircle
"${SSH[@]}" "$HOST" "mkdir -p $DEST/public $DEST/data"
rsync -az -e "${SSH[*]}" server/collector.py server/admin.py server/saves.py server/admin.html "$HOST:$DEST/"
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
git show HEAD:index.html > "$TMP"
rsync -az -e "${SSH[*]}" "$TMP" "$HOST:$DEST/public/index.html"
"${SSH[@]}" "$HOST" "chmod 644 $DEST/public/index.html && sudo systemctl restart fullcircle && sleep 1 && curl -fsS http://127.0.0.1:2504/healthz && echo ' deployed'"
