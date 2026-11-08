#!/usr/bin/env bash
# 备份 SQLite（VACUUM INTO，保证 WAL 一致性）。
# assets/ 是不可变文件，建议同时用卷快照/rsync 备份 studio-data 卷。
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T studio node server/cli.js backup
echo "数据库备份在 studio-data 卷的 /data/backups/ 下；assets 请用卷快照或 rsync 一并备份。"
