// ---------------------------------------------------------------------------
// 管理 CLI：hash-password / set-password / backup
// 用法：node server/cli.js <command> [args]
// ---------------------------------------------------------------------------
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { openDb, migrate, nowIso, getSetting, setSetting } from './db.js';
import { hashPassword, authVersion } from './auth.js';
import { gcAssets } from './gc.js';

const [cmd, ...args] = process.argv.slice(2);
const config = loadConfig();

function usage() {
    console.log(`用法：
  node server/cli.js hash-password <密码>
  node server/cli.js set-password <密码>
  node server/cli.js backup
  node server/cli.js gc [--delete] [--grace-hours=24]

set-password 会递增 auth_version，旧登录会话立即失效。
backup 会生成 data/backups/workshop-<时间>.db（SQLite VACUUM INTO）。
gc 默认 dry-run，只列出未引用资源；--delete 才删除数据库记录与磁盘文件。
只有不被任何草稿/发布引用的资源才会被删；默认跳过 24h 内新建的资源。`);
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

if (cmd === 'gc') {
    const deleteFiles = args.includes('--delete');
    const graceArg = args.find(a => a.startsWith('--grace-hours='));
    const graceHours = graceArg ? Number(graceArg.split('=')[1]) : 24;
    if (!Number.isFinite(graceHours) || graceHours < 0) {
        console.error('--grace-hours 必须是非负数字');
        process.exit(1);
    }
    const db = openDb(config.dbPath);
    migrate(db);
    gcAssets(db, config, { graceHours, deleteFiles });
    db.close();
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
