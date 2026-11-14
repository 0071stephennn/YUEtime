# 约时间

主持人创建活动后直接进入填写页，可以在那里复制群链接。主持人和其他参与者一样填写自己的空闲时间，提交后便可查看按小时汇总的热力图，答卷也计入人数。

## 在本地运行

需要 Node.js 24 或更新版本。在项目目录运行：

```sh
node server.mjs
```

打开 http://127.0.0.1:8787/ 。本地使用 Node.js 内置 SQLite，活动和答卷保存在项目目录的 `yuetime.sqlite`。可用 `YUETIME_PORT` 指定端口。需要同一局域网内其他设备访问时，设置 `YUETIME_HOST=0.0.0.0` 并分享主机的局域网地址。

## 发布到 GitHub 并上线

将本目录作为 GitHub 仓库根目录。线上用 Cloudflare Workers 同时托管页面和 API，用 D1 保存答卷。GitHub Pages 单独只能托管静态文件。

1. 在安装了 npm 的环境里运行 `npx wrangler login`。
2. 运行 `npx wrangler d1 create yuetime`。将返回的数据库 ID 填到 `wrangler.toml` 的 `database_id`。
3. 运行 `npx wrangler d1 migrations apply DB --remote`。
4. 运行 `npx wrangler deploy`，打开输出的 Worker 地址创建活动。

部署说明以 [Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/binding/) 和 [D1 入门文档](https://developers.cloudflare.com/d1/get-started/) 为准。

## 活动到期和数据清理

- 创建时手动选 1–7 个具体日期，可选北京时间今天及之后的日期。页面会显示失效时间。
- 最后一个候选日的次日 00:00（北京时间），链接停止接受答卷和返回结果。例如最后一天是 12 月 6 日，12 月 7 日 00:00 失效。
- Worker 的 Cron 每 5 分钟清理一次。数据库在同一条删除操作里清理到期活动及其所有答卷。本地服务启动时清理一次，运行期间每 5 分钟再清理。
- D1 的 [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) 仍可恢复保留窗口内的数据。当前免费方案为 7 天，付费方案为 30 天。

## 答卷与热力图

- 每个活动为当前浏览器分配会话 Cookie。数据库按活动与会话保存一份答卷，同名可以并存。修改或重试提交会覆盖当前会话的答卷。
- 换浏览器、换设备或清除 Cookie 后会得到新会话。
- 仅已提交的当前会话可以从服务器请求汇总结果。明确提交「这些时间我都来不了」同样计入已回复人数。
- 热力图用背景色显示零人有空，用固定绿色显示全部已回复者有空。部分有空按有空比例由淡橙色过渡至更实的黄绿色。
