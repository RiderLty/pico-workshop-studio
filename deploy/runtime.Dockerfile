# 预构建运行镜像：本地已跑过 web 构建与生产依赖安装，VPS 只做 COPY + 运行。
# 由 deploy/build-dist.sh 复制为 deploy/dist/Dockerfile。
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    HOST=127.0.0.1 \
    PORT=27193 \
    DATA_DIR=/data

COPY package.json package-lock.json ./
COPY node_modules ./node_modules
COPY server ./server
COPY web ./web

RUN addgroup -g 10001 -S app \
    && adduser -u 10001 -S -G app app \
    && mkdir -p /data \
    && chown -R app:app /app /data

USER 10001:10001
VOLUME ["/data"]
EXPOSE 27193

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||27193)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
