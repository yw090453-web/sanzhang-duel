# 联机版部署与运行

## 本机/同 Wi-Fi 手机

安装 Node.js 22，然后在项目根目录执行：

```sh
npm ci
npm run build
npm start
```

电脑访问 `http://localhost:3001`；手机访问 `http://电脑局域网IP:3001`。Windows 可用 `ipconfig` 查看 WLAN 的 IPv4 地址。手机不能用 `localhost` 或 `127.0.0.1` 访问电脑。两台设备须能互相访问，且电脑一直运行服务。

创建牌桌后点击“邀请好友”。用局域网 IP 打开的页面所复制的邀请链接，手机才能使用。在 HTTP 环境剪贴板可能不可用，弹窗仍提供可选择复制的链接和房间码。

## Docker

```sh
docker compose up --build -d
```

容器提供完整前端和后端，端口 3001。构建阶段会运行测试和前端构建；运行阶段不包含原始 vendor 快照，不需要 MongoDB。

## 公网服务器

将这个项目的源码上传到 GitHub 后，可由支持 Docker 或 Node.js 常驻进程的平台从该仓库构建：

- 构建命令：`npm ci && npm run build`
- 启动命令：`npm start`
- 默认监听：`0.0.0.0:3001`，可通过环境变量 `PORT` 和 `HOST` 设置。
- 健康检查：`GET /api/health`。
- 需要保持 WebSocket 连接，不适合仅支持静态文件或短时函数的平台。
- 建议让同一域名同时提供前端、`/api` 与 `/socket.io`；配置 HTTPS。
- 部署一个服务实例。内存房间不能在多个不共享状态的副本之间负载均衡。

Nginx 反向代理例子（放在已配置好域名和 HTTPS 的 server 块内）：

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 90s;
}
```

服务端默认校验浏览器 Origin 和请求 Host。若托管平台转发时改写了 Host，将 `ALLOWED_ORIGINS` 设置为实际页面来源，例如 `https://game.example.com`；多个来源用英文逗号分隔。不要设置为任意来源通配符。

## GitHub Pages 手动发布

本手动上传包已包含构建好的 docs/，无需安装依赖。在仓库 Settings → Pages 中选择 Deploy from a branch，分支 main、目录 /docs，然后 Save。GitHub Pages 提供单机版；完整好友联机需要将仓库部署到上文的 Node.js 或 Docker 服务器。更新源码后，需重新运行 npm run build 并用 dist/ 的新文件更新 docs/。

## 当前数据保存方式

联机会话令牌只保存在自己的浏览器 localStorage 中；分享链接仅带房间码，不携带身份令牌。不要手工向他人提供令牌。

房间和成绩只保存在服务内存中，服务器重启清空；房间空闲 30 分钟关闭。短暂断线保留座位 2 分钟，每步计时仍继续。联机房间是可在大厅看见的普通房间，不是带密码的私密房间。

## 验证范围

自动化测试使用真实 Socket.IO 客户端验证房间隔离、身份校验、越权/过期操作拒绝、看牌隐私、计分、准备、重连、离桌、超时与容量限制。浏览器检查记录见 `online-qa.md`。
