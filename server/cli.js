// ---------------------------------------------------------------------------
// 管理 CLI：hash-password / set-password / backup
// 用法：node server/cli.js <command> [args]
// ---------------------------------------------------------------------------
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { openDb, migrate, nowIso, getSetting, setSetting } from './db.js';
import { hashPassword, authVersion } from './auth.js';

const [cmd, ...args] = process.argv.slice(2);
const config = loadConfig();

function usage() {
    console.log(`用法：
  node server/cli.js hash-password <密码>
  node server/cli.js set-password <密码>
  node server/cli.js backup

set-password 会递增 auth_version，旧登录会话立即失效。
backup 会生成 data/backups/workshop-<时间>.db（SQLite VACUUM INTO）。`);
}

if (cmd === 'hash-password') {
    const password = args[0];
    if (!password) { console.error('缺少密码'); usage(); process.exit(1); }
    console.log(hashPassword(password));
    process.exit(0);
}

if (cmd === 'set-password') {
    const password = args[0] || process.env.ADMIN_PASSWORD;
    if (!password || password.length < 12) { console.error('密码至少 12 个字符'); process.exit(1); }
    const db = openDb(config.dbPath);
    migrate(db);
    setSetting(db, 'admin.password_hash', hashPassword(password));
    setSetting(db, 'admin.auth_version', authVersion(db) + 1);
    if (!getSetting(db, 'admin.username')) setSetting(db, 'admin.username', config.adminUsername);
    db.close();
    console.log('已更新管理员密码，旧会话已失效。');
    process.exit(0);
}

if (cmd === 'backup') {
    const db = openDb(config.dbPath);
    migrate(db);
    fs.mkdirSync(config.backupsDir, { recursive: true });
    const stamp = nowIso().replace(/[:.]/g, '-');
    const out = path.join(config.backupsDir, `workshop-${stamp}.db`);
    db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    db.close();
    console.log(`备份已生成：${out}`);
    process.exit(0);
}

usage();
process.exit(1);
