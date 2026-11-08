// ---------------------------------------------------------------------------
// SQLite（node:sqlite DatabaseSync）打开、迁移、事务包装。
// 所有 SQL 集中在 services/routes 里；这里只负责连接与迁移。
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'db', 'migrations');

export const nowIso = () => new Date().toISOString();

export function openDb(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    return db;
}

export function migrate(db, log = () => {}) {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
    const files = fs.readdirSync(migrationsDir)
        .filter(f => /^\d+_.+\.sql$/.test(f))
        .sort((a, b) => Number(a.slice(0, 3)) - Number(b.slice(0, 3)));
    for (const f of files) {
        const version = Number(f.slice(0, 3));
        if (applied.has(version)) continue;
        const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
        db.exec('BEGIN IMMEDIATE');
        try {
            db.exec(sql);
            db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, nowIso());
            db.exec('COMMIT');
            log(`[db] migration ${f}`);
        } catch (e) {
            try { db.exec('ROLLBACK'); } catch { /* ignore */ }
            throw e;
        }
    }
}

/** 同步事务；发布/回滚必须用它保证原子切换。 */
export function tx(db, fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
        const r = fn();
        db.exec('COMMIT');
        return r;
    } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* ignore */ }
        throw e;
    }
}

export function getSetting(db, key, fallback = null) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .run(key, String(value), nowIso());
}

export function audit(db, action, target = '', ip = '', detail = {}) {
    db.prepare('INSERT INTO audit_log (at, action, target, ip, detail_json) VALUES (?, ?, ?, ?, ?)')
        .run(nowIso(), action, target, ip, JSON.stringify(detail));
}
