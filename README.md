# 甲方要圆

你是地球上手艺最好的工匠，被外星甲方绑回了母星。甲方只有一个需求：所有东西都得是圆的。

一个单文件的 2D 敲击小游戏：拎起材料往地板上砸，把它砸圆。49 单，9 班。

直接打开 `index.html` 就能玩，没有构建步骤。

## 星级和成就

- **星级**：★★★ 就是每单的达标线；★★、★ 各往下让 3、6 个点（起始圆度离达标线很近的单让得少，见 `starLines`），够一星就能交货，时间到了也按当时的星级自动交。没到三星线的酬劳按离一星线多远打折，一星线上是 ×0.6。有星级以前交付过的单一律算三星。
- **成就**：定义表是 `index.html` 里的 `ACH`，分「现场 / 进度 / 手艺 / 坚持 / 怪癖」五组。进度类（有 `goal`/`prog`）从存档就能算，老玩家第一次打开会补发；其余由游戏里的事件触发（`achRound` 在每单结束时统一结算，单局里的在 `impact`、`release` 等处直接 `achUnlock`）。本地存在 `localStorage` 的 `yuan.ach.v1`。

## 线上版本和玩家数据

- 游戏：<https://fullcircle.roosterwho.com/>（roosterpi 上的 `fullcircle.service`，Cloudflare Tunnel `fullcircle` 对外）
- 数据后台：<https://fullcircle.roosterwho.com/admin>，团队密码在 roosterpi 的 `~/services/fullcircle/admin.env`
- 游戏会匿名上报每一单的开工、交付、失败、中途关掉（随机玩家 ID，不存 IP）。本地打开不上报。
- 云存档：玩家在首页可以起个名字，每单最高酬劳、最高星数和解锁的成就会存到服务器，换设备输同一个名字就能接着玩。没有密码，服务器合并时酬劳和星数按每单取较大值、成就取并集，所以同名只会让成绩变高、抹不掉进度；后台「存档玩家」里能看到并删掉不合适的名字。星级和成就存在 `saves` 表的 `extra` 列（JSON），老库启动时自动加列。
- 服务端代码在 `server/`：`collector.py` 收事件写 SQLite，`saves.py` 是云存档，`admin.py` + `admin.html` 是后台。

**部署是自动的**：`main` 上的 HEAD 一变，并且这次变化碰了 `index.html` 或 `server/`，钩子就在后台把 HEAD（不是工作区）部署到 roosterpi：

- 直接提交、`--amend`（`post-commit`）
- 合并分支、`git pull`，包括快进合并（`post-merge`）
- `git rebase`、`git pull --rebase`（`post-rewrite`）

在别的分支或 worktree 上提交不会部署，合并进 `main` 才会。日志在 `.git/deploy.log`，部署失败会弹 macOS 通知。新 clone 要先启用钩子：

```bash
git config core.hooksPath .githooks
```

手动部署：`server/deploy.sh`；跳过一次自动部署：`FC_NO_DEPLOY=1 git commit ...`。终端里看汇总：`ssh roosterpi 'cd ~/services/fullcircle && python3 collector.py report'`。
