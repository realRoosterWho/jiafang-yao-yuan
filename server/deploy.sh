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
rsync -az -e "${SSH[*]}" "$ATMP/assets/" "$HOST:$DEST/public/assets/"
# 压缩版（去注释、去空白，预先压好 br / gzip）放 public/dist/，服务器优先发它。压缩失败就清空 dist，服务器自动退回发源文件
BTMP=$(mktemp -d); trap 'rm -f "$TMP"; rm -rf "$ATMP" "$BTMP"' EXIT
mkdir -p "$BTMP/src" "$BTMP/dist"
git show HEAD:index.html > "$BTMP/src/index.html"; git show HEAD:flow.js > "$BTMP/src/flow.js"
if ! { [ -d tools/node_modules/esbuild ] || npm ci --prefix tools --silent; } || ! node tools/build.mjs "$BTMP/src" "$BTMP/dist"; then
  echo "⚠️ 压缩失败，这次发未压缩的源文件"; rm -rf "$BTMP/dist"; mkdir -p "$BTMP/dist"
fi
rsync -az --delete -e "${SSH[*]}" "$BTMP/dist/" "$HOST:$DEST/public/dist/"
"${SSH[@]}" "$HOST" "chmod 755 $DEST/public/dist && find $DEST/public/dist -type f -exec chmod 644 {} +"
"${SSH[@]}" "$HOST" "chmod 644 $DEST/public/index.html $DEST/public/flow.js && chmod 755 $DEST/public/assets && chmod 644 $DEST/public/assets/* && sudo systemctl restart fullcircle && sleep 1 && curl -fsS http://127.0.0.1:2504/healthz && echo ' deployed'"
