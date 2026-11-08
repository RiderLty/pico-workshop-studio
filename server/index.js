// ---------------------------------------------------------------------------
// 启动入口：配置 → SQLite 迁移 → 管理员初始化 → Hono 服务。
// ---------------------------------------------------------------------------
import { serve } from '@hono/node-server';
import { loadConfig, assertConfig } from './config.js';
import { openDb, migrate } from './db.js';
import { ensureAdmin } from './auth.js';
import { createApp } from './app.js';

const config = loadConfig();
assertConfig(config);

const db = openDb(config.dbPath);
migrate(db, (line) => console.log(line));

try {
    ensureAdmin(db, config);
} catch (e) {
    console.error(`\n启动失败：${e.message}\n`);
    process.exit(1);
}

const app = createApp({ db, config });
const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
}, (info) => {
    console.log('----------------------------------------');
    console.log(`pico-workshop-studio 已启动`);
    console.log(`  本地:      http://localhost:${info.port}`);
    console.log(`  公网地址:  ${config.publicBaseUrl}`);
    console.log(`  数据目录:  ${config.dataDir}`);
    console.log(`  管理员:    ${config.adminUsername}`);
    console.log('----------------------------------------');
});

function shutdown(signal) {
    console.log(`\n[${signal}] 正在退出…`);
    server.close(() => {
        try { db.close(); } catch { /* ignore */ }
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
