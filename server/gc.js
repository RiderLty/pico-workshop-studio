// ---------------------------------------------------------------------------
// 未引用资源回收。
//
// 一个 asset 只要还被以下任一引用，就绝不删除：
//   · 草稿模块 content_asset / icon_asset
//   · 草稿整合包 project_asset / icon_asset
//   · 任一发布版本 release_assets（保留历史版本就必须保留它们的资源）
//
// 删除旧发布记录后，旧版本独占的资源才会变成"未引用"，由 gc 回收。
// 默认 dry-run；--delete 才真的删数据库记录和磁盘文件。
// 默认跳过 24h 内新建的资源，避免和正在进行的上传/发布抢跑。
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { assetDiskPath } from './store.js';

const fmt = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);

export function listUnreferencedAssets(db, { graceHours = 24 } = {}) {
    const cutoff = new Date(Date.now() - graceHours * 3600 * 1000).toISOString();
    return db.prepare(`
        SELECT a.* FROM assets a
        WHERE a.created_at < ?
          AND NOT EXISTS (SELECT 1 FROM modules m WHERE m.content_asset = a.sha256 OR m.icon_asset = a.sha256)
          AND NOT EXISTS (SELECT 1 FROM packs p WHERE p.project_asset = a.sha256 OR p.icon_asset = a.sha256)
          AND NOT EXISTS (SELECT 1 FROM release_assets ra WHERE ra.asset_sha = a.sha256)
        ORDER BY a.created_at
    `).all(cutoff);
}

function removeEmptyParents(config, asset) {
    let dir = path.dirname(assetDiskPath(config, asset));
    for (let i = 0; i < 2; i++) {
        try {
            if (fs.readdirSync(dir).length > 0) return;
            fs.rmdirSync(dir);
            dir = path.dirname(dir);
        } catch { return; }
    }
}

/**
 * @return {{count:number,bytes:number,deleted:number,filesFailed:number,dryRun:boolean}}
 */
export function gcAssets(db, config, { graceHours = 24, deleteFiles = false, log = console.log } = {}) {
    const assets = listUnreferencedAssets(db, { graceHours });
    const bytes = assets.reduce((a, x) => a + x.size_bytes, 0);

    log(`未引用资源：${assets.length} 个，共 ${fmt(bytes)}${deleteFiles ? '' : '（dry-run，加 --delete 才删除）'}`);
    for (const a of assets) {
        log(`  ${a.sha256.slice(0, 12)}…  ${a.kind.padEnd(7)} ${String(a.size_bytes).padStart(8)} B  ${a.created_at}`);
    }
    if (!deleteFiles || assets.length === 0) {
        return { count: assets.length, bytes, deleted: 0, filesFailed: 0, dryRun: !deleteFiles };
    }

    // 先删数据库记录：外键会挡住任何并发新增的引用（release_assets 是 RESTRICT）。
    const del = db.prepare('DELETE FROM assets WHERE sha256 = ?');
    db.exec('BEGIN IMMEDIATE');
    try {
        for (const a of assets) del.run(a.sha256);
        db.exec('COMMIT');
    } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* ignore */ }
        throw e;
    }

    let deleted = 0;
    let filesFailed = 0;
    for (const a of assets) {
        try {
            fs.rmSync(assetDiskPath(config, a), { force: true });
            removeEmptyParents(config, a);
            deleted++;
        } catch (e) {
            filesFailed++;
            log(`  文件删除失败 ${a.sha256}: ${e.message}`);
        }
    }

    // 顺便压缩数据库（旧 release 的 JSON/WAL 也释放掉）；失败不影响回收结果。
    try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        db.exec('VACUUM');
    } catch (e) {
        log(`  VACUUM 跳过：${e.message}`);
    }

    log(`已删除 ${deleted} 个资源文件；数据库记录已清理${filesFailed ? `；${filesFailed} 个文件删除失败` : ''}`);
    return { count: assets.length, bytes, deleted, filesFailed, dryRun: false };
}
