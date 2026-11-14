# 甲方要圆

你是地球上手艺最好的工匠，被外星甲方绑回了母星。甲方只有一个需求：所有东西都得是圆的。

一个单文件的 2D 敲击小游戏：拎起材料往地板上砸，把它砸圆。48 单，8 班。

直接打开 `index.html` 就能玩，没有构建步骤。

## 开场流程（flow.js）

新玩家第一次点开封面，走的是：**播片 → 新手关 → 甲方递合同 → 签名 → 选去处**。整套流程都在 `flow.js` 里，`index.html` 只多了三行（递出几个内部函数的 `window.__yuanFlow`，和末尾的 `<script src="flow.js">`），所以别的分支改 `index.html` 基本不会跟它冲突。

- **播片**：现在是 5 秒以内的占位动画，可以跳过。片子做好以后把地址填进 `flow.js` 顶上的 `CONFIG.video` 就接上了；放完、放不出来、或 5 秒还没开始播，都会自动往下走。`collector.py` 只发 `STATIC` 里列出的文件、也不支持 Range，视频建议放到别处（CDN / 对象存储）再填完整地址。
- **新手关**：一块只有一个凸起的石头，砸不碎、不计时、不上报、不进存档。电脑上提示按住 A / D 旋转，手机上提示第二根手指左右滑。凸起朝下砸一下就过线，砸在圆的那面只会蹭掉一点，不会越砸越糟。参数在 `TUT` 里。
- **合同**：过关后甲方说「做得不错，我们决定雇你」，递过来一张劳务合同，第四条写明完不成任务乙方本人被做成圆形。签名调用的就是原来的起名字存档（`setName` → `/api/save`）；离线打开或服务器连不上时先记在本机。
- **签完以后**：「下一关」（最大的按钮）进第 1 单，「去收藏室选关」现在进的是订单簿，换目标改 `CONFIG.collectionAct`。
- 老玩家（本机有进度，或已经签过合同）点封面还是直接进首页；首页右下角有「重看开场和新手关」。
- 进度记在 `localStorage` 的 `yuan.flow.v1`。调试：`?intro=1` 强制走一遍，`?intro=0` 关掉。
- 不想要这套流程：删掉 `index.html` 末尾的 `<script src="flow.js">`，游戏就回到原来的「封面 → 首页」。`flow.js` 加载失败时也是这样。

## 线上版本和玩家数据

- 游戏：<https://fullcircle.roosterwho.com/>（roosterpi 上的 `fullcircle.service`，Cloudflare Tunnel `fullcircle` 对外）
- 数据后台：<https://fullcircle.roosterwho.com/admin>，团队密码在 roosterpi 的 `~/services/fullcircle/admin.env`
- 游戏会匿名上报每一单的开工、交付、失败、中途关掉（随机玩家 ID，不存 IP）。本地打开不上报。
- 云存档：玩家在首页可以起个名字，每单最高酬劳会存到服务器，换设备输同一个名字就能接着玩。没有密码，服务器按每单取较大值合并，所以同名只会让成绩变高、抹不掉进度；后台「存档玩家」里能看到并删掉不合适的名字。
- 服务端代码在 `server/`：`collector.py` 收事件写 SQLite，`saves.py` 是云存档，`admin.py` + `admin.html` 是后台。

**部署是自动的**：`main` 上的 HEAD 一变，并且这次变化碰了 `index.html`、`flow.js` 或 `server/`，钩子就在后台把 HEAD（不是工作区）部署到 roosterpi：

- 直接提交、`--amend`（`post-commit`）
- 合并分支、`git pull`，包括快进合并（`post-merge`）
- `git rebase`、`git pull --rebase`（`post-rewrite`）

在别的分支或 worktree 上提交不会部署，合并进 `main` 才会。日志在 `.git/deploy.log`，部署失败会弹 macOS 通知。新 clone 要先启用钩子：

```bash
git config core.hooksPath .githooks
```

手动部署：`server/deploy.sh`；跳过一次自动部署：`FC_NO_DEPLOY=1 git commit ...`。终端里看汇总：`ssh roosterpi 'cd ~/services/fullcircle && python3 collector.py report'`。
