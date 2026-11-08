# 多阶段：构建 SPA → 只装生产依赖 → 非 root 运行
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server ./server
COPY --from=build /app/web/dist ./web/dist

RUN addgroup -g 10001 -S app \
    && adduser -u 10001 -S -G app app \
    && mkdir -p /data \
    && chown -R app:app /app /data

USER 10001:10001
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
