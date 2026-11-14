# 甲方要圆

你是地球上手艺最好的工匠，被外星甲方绑回了母星。甲方只有一个需求：所有东西都得是圆的。

一个单文件的 2D 敲击小游戏：拎起材料往地板上砸，把它砸圆。

## 模式

- **冒险模式**是主线：`index.html` 里的 `ADVENTURE` 那几单（每种花样一单，新机制第一次出现时有说明卡）。首页的进度、单子上的「第 x / N 单」都只算这几单，做完弹通关卡、解锁无尽模式。
- **无尽模式**：从 `ORDER` 里全部物品有放回地随机抽。每交一单，甲方耐心（限时）× 0.93，最低到平时的三成（`ENDLESS`）；失败一次（或自己点「收工结算」）这一轮就结束。不能中途重来。最好的一轮存在存档的 `endless: {best, n}`，**排行榜按它排**（这一轮的总酬劳）。无尽模式的事件带 `mode: 'endless'`，后台每单统计不算它们。
- **图鉴**：全部物品，交付过一次就点亮（就是 `SAVE.best` 里有的）；没交付过的是黑剪影 + ？？？。冒险模式之外的物品只能在无尽模式里抽到，第一次抽到时订单卡上有「新物品」，交付了结算卡上写「新物品收进图鉴」，无尽模式收工时列出这一轮新收的。
- **订单簿**藏起来了，是开发者入口：首页右上角的外星人 2.5 秒内连点 10 下打开（记在 `localStorage` 的 `yuan.dev`），订单簿底下能关掉。从订单簿开工是老玩法，一路做到最后一单，做完可以加班。

直接打开 `index.html` 就能玩，没有构建步骤。

## 星级和成就

- **星级**：★★★ 就是每单的达标线；★★、★ 各往下让 3、6 个点（起始圆度离达标线很近的单让得少，见 `starLines`），够一星就能交货，时间到了也按当时的星级自动交。没到三星线的酬劳按离一星线多远打折，一星线上是 ×0.6。有星级以前交付过的单一律算三星。
- **成就**：定义表是 `index.html` 里的 `ACH`，分「现场 / 进度 / 手艺 / 坚持 / 怪癖」五组。进度类（有 `goal`/`prog`）从存档就能算，老玩家第一次打开会补发；其余由游戏里的事件触发（`achRound` 在每单结束时统一结算，单局里的在 `impact`、`release` 等处直接 `achUnlock`）。本地存在 `localStorage` 的 `yuan.ach.v1`。

## 开场流程（flow.js）

新玩家第一次点开封面，走的是：**播片 → 新手关 → 甲方递合同 → 签名 → 选去处**。整套流程都在 `flow.js` 里，`index.html` 只多了三行（递出几个内部函数的 `window.__yuanFlow`，和末尾的 `<script src="flow.js">`），所以别的分支改 `index.html` 基本不会跟它冲突。

- **播片**：现在是 5 秒以内的占位动画，可以跳过。片子做好以后把地址填进 `flow.js` 顶上的 `CONFIG.video` 就接上了；放完、放不出来、或 5 秒还没开始播，都会自动往下走。`collector.py` 只发 `STATIC` 里列出的文件、也不支持 Range，视频建议放到别处（CDN / 对象存储）再填完整地址。
- **新手关**：一块只有一个凸起的石头，砸不碎、不计时、不上报、不进存档。电脑上提示按住 A / D 旋转，手机上提示第二根手指左右滑。凸起朝下砸一下就过线，砸在圆的那面只会蹭掉一点，不会越砸越糟。参数在 `TUT` 里。
- **合同**：过关后甲方说「做得不错，我们决定雇你」，递过来一张劳务合同，第四条写明完不成任务乙方本人被做成圆形。签名调用的就是原来的起名字存档（`setName` → `/api/save`）；离线打开或服务器连不上时先记在本机。
- **签完以后**：「下一关」（最大的按钮）进第 1 单，「去收藏室看看」现在进的是图鉴，换目标改 `CONFIG.collectionAct`。
- 老玩家（本机有进度，或已经签过合同）点封面还是直接进首页；首页右下角有「重看开场和新手关」。
- 进度记在 `localStorage` 的 `yuan.flow.v1`。调试：`?intro=1` 强制走一遍，`?intro=0` 关掉。
- 不想要这套流程：删掉 `index.html` 末尾的 `<script src="flow.js">`，游戏就回到原来的「封面 → 首页」。`flow.js` 加载失败时也是这样。

## 线上版本和玩家数据

- 游戏：<https://fullcircle.roosterwho.com/>（roosterpi 上的 `fullcircle.service`，Cloudflare Tunnel `fullcircle` 对外）
- 数据后台：<https://fullcircle.roosterwho.com/admin>，团队密码在 roosterpi 的 `~/services/fullcircle/admin.env`
- 游戏会匿名上报每一单的开工、交付、失败、中途关掉（随机玩家 ID，不存 IP）。本地打开不上报。
- 云存档：玩家在首页可以起个名字，每单最高酬劳、最高星数、无尽模式最好的一轮和解锁的成就会存到服务器，换设备输同一个名字就能接着玩。没有密码，服务器合并时酬劳和星数按每单取较大值、无尽模式取酬劳高的那轮、成就取并集，所以同名只会让成绩变高、抹不掉进度；后台「存档玩家」里能看到并删掉不合适的名字。星级、成就和无尽纪录存在 `saves` 表的 `extra` 列（JSON），老库启动时自动加列。排行榜（`/api/leaderboard`）只看无尽纪录。
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
