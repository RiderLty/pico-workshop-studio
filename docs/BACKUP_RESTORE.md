# 备份与恢复

## 数据构成

`/data`（Docker 命名卷 `studio-data`，或 `DATA_DIR`）包含：

```
workshop.db       # SQLite 主库（WAL 模式）
workshop.db-wal
workshop.db-shm
assets/           # 内容寻址资源（脚本/图标/.luaproj），不可变
backups/          # cli backup 产物
session.key       # 未设置 SESSION_SECRET 时自动生成
```

- **数据库**保存草稿、发布快照、历史、管理员哈希、托管设置。
- **assets** 保存实际文件，按 SHA-256 命名；发布 JSON 只引用哈希，旧发布永远可读。
- 只备份数据库而丢失 assets，会导致旧发布 404；两者要一起备份。

## 备份数据库

```bash
# 在容器内执行（推荐，WAL 一致）
docker compose exec -T studio node server/cli.js backup
# 产物：/data/backups/workshop-<时间>.db
```

或本地：

```bash
DATA_DIR=./data node server/cli.js backup
```

`cli.js backup` 使用 SQLite `VACUUM INTO`，不需要停服务。

## 备份 assets

assets 不可变，最简单是卷级快照或 rsync：

```bash
# 命名卷 → 当前目录的 tar.gz
docker run --rm -v pico-workshop-studio_studio-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/studio-assets-$(date +%Y%m%d).tar.gz -C /data assets

# 宿主机 bind mount
rsync -a ./data/assets/ /backup/assets/
```

## 恢复

1. 停容器：

   ```bash
   docker compose down
   ```

2. 恢复数据库：把备份的 `.db` 复制成 `data/workshop.db`，并删除旧的 `workshop.db-wal` / `workshop.db-shm`。

3. 恢复 assets：把备份的 `assets/` 放回 `data/assets/`（保留原有目录结构；文件不可变，可直接覆盖）。

4. 如果 `session.key` 没恢复：所有用户需要重新登录；不影响数据。

5. 启动并抽查：

   ```bash
   docker compose up -d
   curl http://127.0.0.1:8080/healthz
   curl -i https://workshop.example.com/w/<slug>/ws.json
   ```

## 定期备份建议

- 每天一次 `cli.js backup`（cron / systemd timer）。
- assets 体积大但只增不减，按周做卷快照或 rsync 增量。
- 备份文件不要放在同一个卷里；至少异机一份。
- 升级前先备份数据库；迁移是前进式的，回退镜像需要同时恢复迁移前备份。
