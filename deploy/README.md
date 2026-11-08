# 部署说明（VPS）

沿用 VPS 现有的 `/root/appdata` 组织方式：

- 服务目录：`/root/appdata/pico-workshop-studio/`
- 容器：`pico-workshop-studio`，host 网络，只监听 `127.0.0.1:27193`
- 数据：`/root/appdata/pico-workshop-studio/data`（映射到容器 `/data`）
- nginx：宿主 nginx 容器（`/root/appdata/nginx`，host 网络）反代 `workshop.rd5isto.top`

## 1. 本地构建预构建产物

VPS 上不跑 npm/Vite，只运行 Docker：

```bash
./deploy/build-dist.sh
# 产出 deploy/dist：server + web/dist + 生产 node_modules + runtime Dockerfile
```

## 2. 推到 VPS

```bash
rsync -az --delete deploy/dist/ root@1.13.189.140:/root/appdata/pico-workshop-studio/
ssh root@1.13.189.140 'mkdir -p /root/appdata/pico-workshop-studio/data && chown -R 10001:10001 /root/appdata/pico-workshop-studio/data'
```

首次部署还需要 `.env`（不要提交）：

```bash
cd /root/appdata/pico-workshop-studio
cp /path/to/.env.example .env
chmod 600 .env
# 至少改：
#   PUBLIC_BASE_URL=https://workshop.rd5isto.top
#   HOST=127.0.0.1
#   PORT=27193
#   ADMIN_PASSWORD=<至少12位>
#   SESSION_SECRET=<openssl rand -base64 32>
#   TRUST_PROXY=1
```

## 3. 启动

```bash
cd /root/appdata/pico-workshop-studio
docker compose up -d --build
curl -s http://127.0.0.1:27193/healthz
```

`docker compose` 使用目录里的 `Dockerfile`（预构建运行镜像）和 `docker-compose.yml`，
只做 COPY + 非 root 运行，不编译前端。

## 4. nginx

把仓库里的 `deploy/nginx/workshop.rd5isto.top.conf` 复制到 VPS：

```bash
scp deploy/nginx/workshop.rd5isto.top.conf \
  root@1.13.189.140:/root/appdata/nginx/conf.d/

ssh root@1.13.189.140 \
  'docker exec nginx nginx -t && docker exec nginx nginx -s reload'
```

该配置使用现有的 `*.rd5isto.top` 通配符证书，反代到 `127.0.0.1:27193`。

## 5. 验证

```bash
curl -s https://workshop.rd5isto.top/healthz
curl -i https://workshop.rd5isto.top/w/main/ws.json
```

- 管理入口：`https://workshop.rd5isto.top/`
- 公开源：`https://workshop.rd5isto.top/w/<slug>/ws.json`
- 固件构建：
  ```bash
  DEFAULT_WORKSHOP_SOURCE='https://workshop.rd5isto.top/w/main/ws.json' ./build.sh
  ```

## 6. 备份 / 升级

- 数据库：`docker compose exec studio node server/cli.js backup`（产物在 `data/backups/`）
- 数据/资源：直接备份 `/root/appdata/pico-workshop-studio/data/`
- 升级：本地重新 `./deploy/build-dist.sh` → rsync → `docker compose up -d --build`
- 改密：`docker compose exec studio node server/cli.js set-password '新密码'`（旧会话立即失效）
