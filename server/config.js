// ---------------------------------------------------------------------------
// 运行期配置：全部来自环境变量；数据目录默认 ./data（Docker 里是 /data）。
// 不在代码里放任何默认密码：没有 ADMIN_PASSWORD(_HASH) 且库里也没有管理员时，
// 启动直接失败并打印初始化命令。
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function loadOrCreateSessionKey(dataDir) {
    const p = path.join(dataDir, 'session.key');
    try {
        const v = fs.readFileSync(p);
        if (v.length >= 32) return v.toString('base64url');
    } catch { /* 不存在 */ }
    const key = crypto.randomBytes(32);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(p, key, { mode: 0o600 });
    return key.toString('base64url');
}

export function loadConfig(env = process.env) {
    const dataDir = path.resolve(env.DATA_DIR || 'data');
    const assetsDir = path.join(dataDir, 'assets');
    const backupsDir = path.join(dataDir, 'backups');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.mkdirSync(backupsDir, { recursive: true });

    const port = Number(env.PORT || 8080);
    const publicBaseUrl = (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');

    const allowedOrigins = new Set();
    try { allowedOrigins.add(new URL(publicBaseUrl).origin); } catch { /* 非法由启动检查兜底 */ }
    if (env.DEV_ORIGIN) {
        try { allowedOrigins.add(new URL(env.DEV_ORIGIN).origin); } catch { /* ignore */ }
    }
    if (env.NODE_ENV !== 'production') {
        allowedOrigins.add('http://localhost:5173');
        allowedOrigins.add('http://127.0.0.1:5173');
    }

    return {
        dataDir,
        assetsDir,
        backupsDir,
        dbPath: path.join(dataDir, 'workshop.db'),
        host: env.HOST || '0.0.0.0',
        port,
        publicBaseUrl,
        adminUsername: env.ADMIN_USERNAME || 'admin',
        adminPassword: env.ADMIN_PASSWORD || '',
        adminPasswordHash: env.ADMIN_PASSWORD_HASH || '',
        sessionSecret: env.SESSION_SECRET || loadOrCreateSessionKey(dataDir),
        trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
        allowedOrigins,
        nodeEnv: env.NODE_ENV || 'development',
        enableUrlImport: env.ENABLE_URL_IMPORT === '1',
    };
}

/** 启动前置校验：生产环境必须给公网地址；非法 PUBLIC_BASE_URL 直接退出。 */
export function assertConfig(config) {
    let u;
    try { u = new URL(config.publicBaseUrl); }
    catch { throw new Error(`PUBLIC_BASE_URL 不是合法地址：${config.publicBaseUrl}`); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error('PUBLIC_BASE_URL 只支持 http/https');
    }
    if (config.nodeEnv === 'production' && u.protocol !== 'https:' && process.env.ALLOW_INSECURE !== '1') {
        console.warn('[warn] 生产环境 PUBLIC_BASE_URL 不是 https，登录 Cookie 不会带 Secure；确认反向代理已终止 TLS');
    }
}
