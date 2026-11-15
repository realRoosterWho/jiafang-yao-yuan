#!/usr/bin/env bash
# 把 index.html、flow.js、assets/ 和收集服务推到 roosterpi 并重启。数据库（data/）不会被覆盖。
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
# flow.js（开场流程：播片、新手关、签合同）和 index.html 一起发布，同样只发 HEAD 里的版本
git show HEAD:flow.js > "$TMP"
rsync -az -e "${SSH[*]}" "$TMP" "$HOST:$DEST/public/flow.js"
# 图片和字体（assets/，文件名带哈希）：也只发 HEAD 里的；旧的留着，还开着老页面的人不会缺图
ATMP=$(mktemp -d); trap 'rm -f "$TMP"; rm -rf "$ATMP"' EXIT
git archive HEAD assets | tar -x -C "$ATMP"
rsync -az --chmod=D755,F644 -e "${SSH[*]}" "$ATMP/assets/" "$HOST:$DEST/public/assets/"
"${SSH[@]}" "$HOST" "chmod 644 $DEST/public/index.html $DEST/public/flow.js && sudo systemctl restart fullcircle && sleep 1 && curl -fsS http://127.0.0.1:2504/healthz && echo ' deployed'"
