#!/usr/bin/env bash
# 在 VPS 上回收未引用资源：默认 dry-run；加 --delete 才真正删除。
# 用法：./gc.sh [--delete] [--grace-hours=24]
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T studio node server/cli.js gc "$@"
