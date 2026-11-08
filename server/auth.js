// ---------------------------------------------------------------------------
// 单管理员认证：scrypt 密码 + HMAC 签名 HttpOnly Cookie + CSRF Token。
// 不引入 JWT / session 库；全部用 node:crypto。
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { getSetting, setSetting } from './db.js';

export const COOKIE_NAME = 'pws_session';
export const SESSION_DAYS = 7;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const SCRYPT_KEYLEN = 64;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

export function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, {
        N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM,
    });
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${b64u(salt)}$${b64u(hash)}`;
}

export function verifyPassword(password, stored) {
    try {
        const [algo, N, r, p, salt, hash] = String(stored || '').split('$');
        if (algo !== 'scrypt') return false;
        const derived = crypto.scryptSync(String(password), fromB64u(salt), SCRYPT_KEYLEN, {
            N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT_MAXMEM,
        });
        const expected = fromB64u(hash);
        return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
    } catch { return false; }
}

/** 用户不存在时也跑一次 scrypt，降低时序差异。 */
export function dummyVerify() {
    try { hashPassword('dummy-password'); } catch { /* ignore */ }
}

export function ensureAdmin(db, config) {
    const existing = getSetting(db, 'admin.password_hash', '');
    if (existing) {
        if (!getSetting(db, 'admin.username')) setSetting(db, 'admin.username', config.adminUsername);
        if (getSetting(db, 'admin.auth_version') == null) setSetting(db, 'admin.auth_version', '0');
        return;
    }
    let hash = config.adminPasswordHash;
    if (!hash && config.adminPassword) {
        if (String(config.adminPassword).length < 12) {
            throw new Error('ADMIN_PASSWORD 至少 12 个字符');
        }
        hash = hashPassword(config.adminPassword);
    }
    if (!hash) {
        throw new Error(
            '还没有管理员密码。请用环境变量初始化：\n'
            + '  ADMIN_PASSWORD=\'至少12位密码\' 或 ADMIN_PASSWORD_HASH=...\n'
            + '  生成哈希：node server/cli.js hash-password \'你的密码\'\n'
            + '也可以先设置 ADMIN_PASSWORD 启动一次，之后用 `node server/cli.js set-password` 改密。',
        );
    }
    setSetting(db, 'admin.password_hash', hash);
    setSetting(db, 'admin.username', config.adminUsername);
    setSetting(db, 'admin.auth_version', '0');
}

export function authVersion(db) {
    return Number(getSetting(db, 'admin.auth_version', '0')) || 0;
}

export function adminUsername(db) {
    return getSetting(db, 'admin.username', 'admin');
}

function hmac(secret, text) {
    return crypto.createHmac('sha256', secret).update(text).digest();
}

export function signSession(payload, secret) {
    const body = b64u(JSON.stringify(payload));
    return `${body}.${b64u(hmac(secret, body))}`;
}

export function verifySession(value, secret) {
    if (!value || typeof value !== 'string') return null;
    const [body, sig] = value.split('.');
    if (!body || !sig) return null;
    const expected = hmac(secret, body);
    const got = fromB64u(sig);
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
    try {
        const payload = JSON.parse(fromB64u(body).toString('utf8'));
        if (!payload || payload.sub !== 'admin') return null;
        if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
        return payload;
    } catch { return null; }
}

export function csrfFor(jti, secret) {
    return b64u(hmac(secret, `csrf:${jti}`));
}

export function issueSession(db, config) {
    const now = Date.now();
    const payload = {
        sub: 'admin',
        ver: authVersion(db),
        iat: now,
        exp: now + SESSION_DAYS * 24 * 3600 * 1000,
        jti: crypto.randomUUID(),
    };
    const cookie = signSession(payload, config.sessionSecret);
    return { payload, cookie, csrfToken: csrfFor(payload.jti, config.sessionSecret), expiresAt: payload.exp };
}

export function setSessionCookie(c, cookie, config) {
    setCookie(c, COOKIE_NAME, cookie, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: SESSION_DAYS * 24 * 3600,
        secure: config.publicBaseUrl.startsWith('https://'),
    });
}

export function clearSessionCookie(c) {
    deleteCookie(c, COOKIE_NAME, { path: '/' });
}

export function readSession(c, db, config) {
    const raw = getCookie(c, COOKIE_NAME);
    if (!raw) return null;
    const payload = verifySession(raw, config.sessionSecret);
    if (!payload) return null;
    if (payload.ver !== authVersion(db)) return null;
    return payload;
}

export function clientIp(c, config) {
    if (config.trustProxy) {
        const xff = c.req.header('x-forwarded-for');
        if (xff) return xff.split(',')[0].trim();
    }
    const raw = c.req.raw;
    return raw?.headers?.get('x-real-ip') || 'unknown';
}

/** 极简登录限速：按 IP，15 分钟 5 次失败。 */
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

export function checkLoginRate(ip) {
    const f = failures.get(ip);
    if (!f) return;
    if (f.until > Date.now()) {
        const sec = Math.ceil((f.until - Date.now()) / 1000);
        const err = new Error(`登录失败次数过多，请 ${sec} 秒后再试`);
        err.status = 429;
        throw err;
    }
    if (Date.now() - f.first > WINDOW_MS) failures.delete(ip);
}

export function recordLoginFailure(ip) {
    const now = Date.now();
    const f = failures.get(ip);
    if (!f || now - f.first > WINDOW_MS) {
        failures.set(ip, { first: now, count: 1, until: 0 });
        return;
    }
    f.count++;
    if (f.count >= MAX_FAILS) f.until = now + WINDOW_MS;
}

export function clearLoginFailures(ip) {
    failures.delete(ip);
}
