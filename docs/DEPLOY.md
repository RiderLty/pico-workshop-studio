# 部署

## 前置

- 一台能跑 Docker 的 VPS；
- 一个域名（建议独立子域，如 `workshop.example.com`）；
- 反向代理负责 TLS（Caddy 或 Nginx）。

## 1. 拉代码与配置

```bash
git clone <repo> pico-workshop-studio
cd pico-workshop-studio
cp .env.example .env
```

编辑 `.env`：

```ini
PUBLIC_BASE_URL=https://workshop.example.com
HOST=127.0.0.1
PORT=27193
ADMIN_USERNAME=admin
ADMIN_PASSWORD=换成至少12位的强密码
SESSION_SECRET=openssl rand -base64 32 的输出
TRUST_PROXY=1
```

`PUBLIC_BASE_URL` 必须与外部访问地址完全一致（协议 + 域名，不带结尾斜杠）。它决定：

- 登录时的 Origin 白名单；
- 页面复制的工坊源地址；
- 导出说明里的地址。

## 2. 启动

```bash
docker compose up -d --build
curl http://127.0.0.1:27193/healthz
```

容器用 host 网络，应用只绑定 `127.0.0.1:27193`，公网由反代进入。数据在 `./data`（映射到容器 `/data`）。

## 3. 反向代理

### Caddy

把 `deploy/Caddyfile` 里的域名改成你的，取消 `docker-compose.yml` 里 caddy 服务的注释，或者用宿主机 Caddy：

```caddyfile
workshop.example.com {
    encode zstd gzip
    request_body { max_size 40MB }
    reverse_proxy 127.0.0.1:27193
}
```

### Nginx

参考 `deploy/nginx.conf`：

- `client_max_body_size 40m;`（上传/ZIP 导入）
- `proxy_set_header Host $host;`
- `proxy_set_header X-Forwarded-Proto $scheme;`
- `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`

设置 `TRUST_PROXY=1` 后服务端才会信任这些头。

## 4. 卷权限

默认就是宿主机 bind mount `./data:/data`，需要把目录属主改成容器 UID：

```bash
mkdir -p data
sudo chown -R 10001:10001 data
```

容器以非 root 运行，根文件系统只读，只有 `/data` 与 `/tmp` 可写。

## 5. 升级

```bash
# 先备份
./deploy/backup.sh
git pull
docker compose build
docker compose up -d
```

启动时自动执行 SQLite 迁移；迁移前会记录 schema 版本。若新版本迁移失败，容器不会启动，旧容器/数据仍在，先看日志：

```bash
docker compose logs -f studio
```

## 6. 常见问题

| 现象 | 排查 |
|---|---|
| 登录提示“请求来源不被允许” | `PUBLIC_BASE_URL` 与实际访问地址不一致（端口/协议/域名） |
| 面板报“无法访问：网络不可达或未开启跨域” | 公开地址必须允许 `Access-Control-Allow-Origin: *`；外部 CDN 也要带；确认 `serve_items`/`serve_assets` 开关 |
| 上传/ZIP 413 | 反代 `client_max_body_size` 太小（建议 40MB） |
| 容器启动失败提示 SQLite experimental | 正常只影响日志；镜像启动参数已 `--disable-warning=ExperimentalWarning` |
| 复制出来的源地址是 localhost | 没配 `PUBLIC_BASE_URL` 或仍是示例值 |
| 修改名字后公网没变 | 名字在发布时写入目录头；需要重新发布 |
| 改了托管模式/外部地址但公网没变 | 需要重新发布（公开开关即时生效） |
