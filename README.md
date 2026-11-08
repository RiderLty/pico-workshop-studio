# Pico 工坊工作室（pico-workshop-studio）

Lua 创意工坊的**作者侧管理工具**：在 VPS 的 Docker 里跑，单管理员登录，管理模块 / 整合包 / 脚本 / 图标，支持草稿、发布、历史回滚、ZIP 与 JSON 导出，并产出一个可写进固件作为默认源的公网地址。

- 协议权威：`pico-hid-mapper/docs/LUA_WORKSHOP.md`
- 许可证：GPL-3.0
- 单进程、零原生依赖：Node 22.5+（Docker 镜像用 Node 22 Alpine，22.23）+ SQLite（`node:sqlite`）+ 内容寻址资源库

## 功能

- 多个工坊，每个有独立的 `/w/<slug>/ws.json` 公开地址。
- 模块：元数据、Lua 代码编辑器（CodeMirror 6）、图标、排序。
- 整合包：引用模块（有序、可停用）或上传现成 `.luaproj`。
- 草稿 → 发布 → 历史版本；回滚会生成**新修订**，不会改写历史。
- 版本号由内容指纹决定：内容没变不递增，变了自动 +1。
- 导出：
  - **ZIP**：`ws.json` + `items.json` + `scripts/` + `icons/` + `packs/`，整包上传静态托管。
  - **仅图标内联 JSON**：图标 `data:image`，脚本/包仍指向本服务器 assets。
  - **全部内联 JSON**：脚本 `inlineBase64`、图标 `data:image`；只把 `items.json` 上传 CDN，`ws.json` 仍是一份极小的目录索引（两文件版，不扩展面板协议）。
- 托管：
  - `server`：本服务器托管 `items.json` 与 assets；
  - `external`：目录头 `url` 指向外部 CDN 的 `items.json`；
  - `serve_items` / `serve_assets` 两个公开开关，`ws.json`（目录索引）始终公开。
- 单管理员：scrypt 密码 + HMAC 签名 HttpOnly Cookie + CSRF + Origin 校验 + 登录限速。
- 所有资源按 SHA-256 内容寻址、不可变、去重；发布是 SQLite 事务，公开路由直接读当前 release。

## 快速开始（Docker）

```bash
cp .env.example .env
# 编辑 .env：PUBLIC_BASE_URL、ADMIN_PASSWORD（至少 12 位）、SESSION_SECRET
docker compose up -d --build
curl http://127.0.0.1:27193/healthz
```

`.env.example` 按 VPS 的 appdata 约定预置了 `HOST=127.0.0.1`、`PORT=27193`；容器用 host 网络，只监听本机回环，由 nginx 反代。`PUBLIC_BASE_URL` 必须等于外部访问地址（例如 `https://workshop.rd5isto.top`），否则登录 Origin 校验和复制出来的源地址会不对。

- 本仓库的 VPS 配置：`deploy/nginx/workshop.rd5isto.top.conf`
- 通用 Caddy 示例：`deploy/Caddyfile`
- 通用 Nginx 示例：`deploy/nginx.conf`

### 预构建部署（VPS 只跑 Docker）

VPS 上不跑 npm/Vite，前端在本地构建好再推：

```bash
./deploy/build-dist.sh
tar -C deploy/dist -czf - . | ssh root@<VPS> \
  'tar -xzf - -C /root/appdata/pico-workshop-studio'
ssh root@<VPS> 'cd /root/appdata/pico-workshop-studio && docker compose up -d --build'
```

详见 `deploy/README.md`。

### 用 GitHub Actions 构建的镜像部署

标签 `v*` 会触发 Release workflow：

- 跑测试、构建预构建产物；
- 构建并推送多架构镜像到 GHCR（`linux/amd64,linux/arm64`）；
- 创建 GitHub Release，附 `pico-workshop-studio-dist.tar.gz` 与 sha256。

```bash
git tag v0.1.0
git push origin v0.1.0
```

镜像地址：

```
ghcr.io/riderlty/pico-workshop-studio:latest
ghcr.io/riderlty/pico-workshop-studio:0.1.0
```

服务器上直接拉镜像运行（不需要源码 / npm / Vite）：

```bash
cp docker-compose.ghcr.yml docker-compose.yml
docker compose pull
docker compose up -d
```

也可以保留文件名：

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

Docker Hub 镜像（配置了对应 Secrets 后）：

```
docker.io/<你的 Docker Hub 用户名>/pico-workshop-studio:latest
```

用 Docker Hub 时在 `.env` 里覆盖：

```bash
STUDIO_IMAGE=docker.io/<用户名>/pico-workshop-studio:latest
```

### Token / Secrets

**默认不需要填写任何 token。** Release workflow 使用 GitHub 自动提供的 `GITHUB_TOKEN`：

- `packages: write`：推送 GHCR
- `contents: write`：创建 GitHub Release

只有这些情况需要额外配置：

| 场景 | 需要 |
|---|---|
| GHCR 包是 private，服务器要拉 | classic PAT（勾 `read:packages`），服务器 `docker login ghcr.io -u RiderLty -p <PAT>`；或把包设为 public（推荐，无需 token） |
| 想同时推 Docker Hub | 仓库 Secrets 加 `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`（Docker Hub Access Token，Read & Write）；workflow 已内置可选步骤，未配置则自动跳过 |
| 想手动触发镜像构建（不打 tag） | Actions → Release → Run workflow，无需额外 token |
| 清理 GHCR 旧版本报 403 | 仓库 Secrets 加 `GHCR_CLEANUP_TOKEN`（classic PAT，勾 `read:packages` + `delete:packages`）；默认先用 `GITHUB_TOKEN` |

> GHCR 包首次发布后若仍是 private，可在 GitHub → Packages → `pico-workshop-studio` → Package settings 改为 public；workflow 里的 `Make GHCR package public` 步骤也会尝试自动改，失败不影响镜像。

### 删除旧版本

**工坊发布历史**：后台「发布历史」页可以删除非当前版本；当前公开版本不能删（先发布或回滚到别的版本）。
只删除发布记录，不回收已上传的不可变资源文件。

**GHCR 镜像 / GitHub Release**：Actions → **Cleanup old versions** → Run workflow，参数：

- `keep`：保留多少个旧版本（默认 5；`latest` 永远保留）
- `dry_run`：默认 `true`，只打印要删的内容
- `delete_releases`：默认 `false`；勾选后同时删除旧 GitHub Release 与 tag

手动触发：

```bash
gh workflow run cleanup.yml -f keep=5 -f dry_run=true
```

## 本地运行

```bash
npm install
npm run build
DATA_DIR=./data \
PORT=8080 HOST=127.0.0.1 \
ADMIN_PASSWORD='test-password-123' \
PUBLIC_BASE_URL=http://localhost:8080 \
npm start
```

开发模式（后端 8080 + Vite 5173）：

```bash
npm run dev:server
npm run dev:web
# 打开 http://localhost:5173 （Vite 已代理 /api、/w）
```

测试：

```bash
npm test
```

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `PUBLIC_BASE_URL` | 是 | 外部访问地址，不带结尾斜杠；生产环境建议 https |
| `ADMIN_USERNAME` | 否 | 默认 `admin` |
| `ADMIN_PASSWORD` | 首次 | 首次启动用来生成哈希，至少 12 位；之后库里的哈希优先 |
| `ADMIN_PASSWORD_HASH` | 否 | `node server/cli.js hash-password '密码'` 生成；优先于明文密码 |
| `SESSION_SECRET` | 否 | 留空自动生成 `data/session.key`；建议显式设置 |
| `DATA_DIR` | 否 | 默认 `./data`；Docker 里是 `/data` |
| `HOST` | 否 | 默认 `0.0.0.0`；VPS 的 `.env` 设为 `127.0.0.1`（host 网络下只给 nginx） |
| `PORT` | 否 | 默认 8080；VPS 的 `.env` 设为 `27193` |
| `TRUST_PROXY` | 否 | 反向代理后设 `1`，才会使用 `X-Forwarded-For` |
| `ENABLE_URL_IMPORT` | 否 | v1.1 URL 导入开关，默认关闭 |

首次启动没有可用管理员密码时会直接失败并打印初始化命令。改密：

```bash
node server/cli.js set-password '新的至少12位密码'
```

改密会递增 `auth_version`，所有旧登录立即失效。

## 公开路由与 CORS

| 路由 | 说明 |
|---|---|
| `GET /w/:slug/ws.json` | 目录索引，始终公开；`Cache-Control: no-store` |
| `GET /w/:slug/items.json` | 仅 `serve_items=1` 时公开；否则 404 |
| `GET /w/:slug/assets/:sha.:ext` | 仅 `serve_assets=1` 时公开；不可变缓存 + ETag |

公开路由统一带 `Access-Control-Allow-Origin: *`（包括 404），面板的浏览器用纯 GET 直接读取。管理 API `/api/*` 不加 CORS，必须登录 + CSRF。

## 导出档位怎么选

| 档位 | 产物 | 适用 |
|---|---|---|
| `zip` | 目录头 + items + 脚本/图标/包文件 | 整包上传 GitHub Pages / Cloudflare Pages / 对象存储 |
| `icons` | ws.json + items.json（图标 data URL） | 图标多、脚本大，脚本/包继续由本服务器 assets 提供 |
| `inline` | ws.json + items.json（脚本与图标全内联） | 只把 `items.json` 上传 CDN；`ws.json` 仍单独一份 |

> 全内联 `items.json` 上限 512KB；超出请用 `zip` 或拆分。导出档位是派生表示，不占 revision；切换 CDN 地址或托管模式后请发布新修订。

## 固件默认源

工具页面会显示每个工坊的源地址：

```
https://workshop.example.com/w/<slug>/ws.json
```

把**这个 ws.json 地址**作为构建期变量传给固件：

```bash
DEFAULT_WORKSHOP_SOURCE='https://workshop.example.com/w/main/ws.json' ./build.sh
```

面板首次打开工坊会自动种入这个源；用户删除后不会复活；清站点数据等于首次打开，会重新种入。未激活设备仍然可以浏览，导入仍受许可证限制。

## 数据与备份

`/data`（或 `DATA_DIR`）里：

```
workshop.db           # SQLite（WAL）
assets/<sha>/...      # 内容寻址资源，不可变
backups/              # cli backup 生成
session.key           # 未设置 SESSION_SECRET 时自动生成
```

- 数据库备份：`node server/cli.js backup`（`VACUUM INTO`，WAL 一致）。
- assets 不可变，建议同时用卷快照 / `tar` 备份。
- 恢复：停容器 → 替换 `workshop.db`（删掉 `-wal/-shm`）→ 恢复/保留 `assets/` → 启动 → `/healthz` 与公开 URL 抽查。
- 只恢复 DB 而丢 assets 会让旧发布 404。详见 `docs/BACKUP_RESTORE.md`。

### 资源回收

`assets/` 只增不减；删除旧发布记录后，旧版本独占的文件才会变成未引用。VPS 上：

```bash
docker compose exec -T studio node server/cli.js gc           # dry-run，先看会删什么
docker compose exec -T studio node server/cli.js gc --delete  # 真正删除
```

GC 只删除**不被任何草稿模块/整合包、也不被任何发布版本引用**的资源，默认跳过 24 小时内新建的资源；当前版本和草稿正在用的文件不会动。建议每周跑一次：

```cron
0 4 * * 0 cd /root/appdata/pico-workshop-studio && docker compose exec -T studio node server/cli.js gc --delete >> /var/log/pico-workshop-gc.log 2>&1
```

> 如果旧发布记录还在，它的资源会被保留（为了历史和回滚）。要回收旧版本资源，先在后台「发布历史」删除不再需要的版本，再跑 gc。

## 部署

- VPS / appdata / nginx / 预构建产物：见 `deploy/README.md`
- 通用 Docker / Caddy / Nginx / 升级：见 `docs/DEPLOY.md`

## 安全

- 单管理员，无注册；生产必须 HTTPS。
- 管理 API 同源、Cookie + CSRF + Origin；公开 API 只读且只暴露已发布内容。
- 上传：脚本 ≤1MB、图标 ≤256KB；图标只收 PNG/JPEG/GIF/WebP（拒绝 SVG）；所有文件按内容哈希落盘，不用用户路径。
- 公开资源只允许该工坊发布引用过的资产。
- URL 导入（v1.1）默认关闭；开启后需要 SSRF 防护。

## 协议

`ws.json` / `items.json` 的字段与限制以 `pico-hid-mapper/docs/LUA_WORKSHOP.md` 为准。本工具生成的结果会用同一套规则校验；发布前管理端点 `/api/workshops/:id/validation` 会给出错误与警告。
