#!/usr/bin/env bash
# 本地构建可部署产物：web/dist + 生产依赖 + server。
# VPS 上不需要 npm/Vite，只需要 Docker（runtime.Dockerfile 只做 COPY）。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[1/5] 安装依赖"
npm ci

echo "[2/5] 构建前端"
npm run build

echo "[3/5] 组装 deploy/dist"
rm -rf deploy/dist
mkdir -p deploy/dist/web
cp package.json package-lock.json deploy/dist/
cp -R server deploy/dist/
cp -R web/dist deploy/dist/web/dist

echo "[4/5] 安装生产依赖"
npm ci --omit=dev --prefix deploy/dist

echo "[5/5] 复制运行镜像与 compose"
cp deploy/runtime.Dockerfile deploy/dist/Dockerfile
cp deploy/docker-compose.runtime.yml deploy/dist/docker-compose.yml

echo "完成：deploy/dist"
du -sh deploy/dist
echo "下一步：rsync -az --delete deploy/dist/ root@<VPS>:/root/appdata/pico-workshop-studio/"
