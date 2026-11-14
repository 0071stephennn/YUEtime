# YUEtime · 约时间

给群里的朋友发一条链接，收集大家的空闲时间。提交答卷后，可以在热力图上看到每小时有几人有空。 [打开 YUEtime](https://yuetime.time-push.workers.dev/)

## 怎么用

1. **建表。** 填活动名称，在月历上选候选日期，再点整点按钮设置每天的起止时间。最早和最晚的日期合计最多覆盖 7 个自然日，中间可以跳过日期。可以拖选，也可以点「连选日期」后点首尾两天。
2. **分享。** 创建活动后直接进入填写页。点「复制群链接」发给参与者。主持人也填写自己的时间。
3. **填写。** 首次打开该活动的填写页会显示指南，点右上角的「×」即可关闭。时间表显示连续七天，灰色列标出非候选日期，候选日期中的周末带浅底色。填上名字后，点单格切换，点日期表头选整天，也可以拖动或用「框选时段」点两个对角格。全程没空可以提交「这些时间我都来不了」。
4. **看结果。** 提交后进入热力图。绿色表示所有已回复者都有空，橙色至黄绿色表示部分有空，背景色表示无人有空。点格子可以查看名单。再次打开群链接时，已提交的浏览器会直接进入热力图，可点「修改我的时间」更新原答卷。

## 在本地运行

需要 Node.js 24 或更新版本。在项目目录运行：

```sh
node server.mjs
```

打开 http://127.0.0.1:8787/ 。本地使用 Node.js 内置 SQLite，活动和答卷保存在项目目录的 `yuetime.sqlite`。可用 `YUETIME_PORT` 指定端口。需要同一局域网内其他设备访问时，设置 `YUETIME_HOST=0.0.0.0` 并分享主机的局域网地址。

## 部署到 Cloudflare

Cloudflare Workers 同时托管页面和 API，D1 保存活动和答卷。

1. 在安装了 npm 的环境里运行 `npx wrangler login`。
2. 运行 `npx wrangler d1 create yuetime`。将返回的数据库 ID 填到 `wrangler.toml` 的 `database_id`。
3. 运行 `npx wrangler d1 migrations apply DB --remote`。
4. 运行 `npx wrangler deploy`，打开输出的 Worker 地址创建活动。

部署说明以 [Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/binding/) 和 [D1 入门文档](https://developers.cloudflare.com/d1/get-started/) 为准。

## 活动到期和数据清理

- 建表时会显示失效时间。如果最后一个候选日是 12 月 6 日，链接在北京时间 12 月 7 日 00:00 停止接收答卷和返回结果。
- Worker 的 Cron 每天北京时间 00:00 运行，即 UTC 16:00。数据库在同一条删除操作里清理到期活动及其所有答卷。本地服务在启动时及之后的每个北京时间零点清理。
- D1 的 [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) 仍可恢复保留窗口内的数据。当前免费方案为 7 天，付费方案为 30 天。

## 浏览器如何识别答卷

群链接只包含活动 ID。服务端按活动和浏览器会话保存答卷，因此同名参与者也可以分别提交。换浏览器、设备或使用新的无痕窗口时，会进入新的会话。「这些时间我都来不了」也计入已回复人数。
