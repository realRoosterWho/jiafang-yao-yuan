# 甲方要圆

你是地球上手艺最好的工匠，被外星甲方绑回了母星。甲方只有一个需求：所有东西都得是圆的。

一个单文件的 2D 敲击小游戏：拎起材料往地板上砸，把它砸圆。24 单，4 班。

直接打开 `index.html` 就能玩，没有构建步骤。

## 线上版本和玩家数据

- 游戏：<https://fullcircle.roosterwho.com/>（roosterpi 上的 `fullcircle.service`，Cloudflare Tunnel `fullcircle` 对外）
- 数据后台：<https://fullcircle.roosterwho.com/admin>，团队密码在 roosterpi 的 `~/services/fullcircle/admin.env`
- 游戏会匿名上报每一单的开工、交付、失败、中途关掉（随机玩家 ID，不存 IP）。本地打开不上报。
- 服务端代码在 `server/`：`collector.py` 收事件写 SQLite，`admin.py` + `admin.html` 是后台。

**部署是自动的**：在 `main` 上提交、并且改动了 `index.html` 或 `server/`，`post-commit` 钩子会在后台把这次提交（HEAD，不是工作区）部署到 roosterpi，日志在 `.git/deploy.log`。新 clone 要先启用钩子：

```bash
git config core.hooksPath .githooks
```

手动部署：`server/deploy.sh`；跳过一次自动部署：`FC_NO_DEPLOY=1 git commit ...`。终端里看汇总：`ssh roosterpi 'cd ~/services/fullcircle && python3 collector.py report'`。
