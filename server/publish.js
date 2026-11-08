// ---------------------------------------------------------------------------
// 发布 / 回滚：DB 事务是公网切换点。
// 版本号只由内容指纹决定：无变化不递增，有变化 +1，回滚生成新 revision。
// ---------------------------------------------------------------------------
import { tx, nowIso, audit } from './db.js';
import {
    buildDraft, validateDraft, buildItems, buildManifest, fingerprint, sourceUrl,
} from './protocol.js';
import { publicAssetPath } from './store.js';

function snapshotOf(draft) {
    return {
        workshop: {
            slug: draft.workshop.slug,
            name: draft.workshop.name,
            items_mode: draft.workshop.items_mode,
            external_items_url: draft.workshop.external_items_url,
        },
        modules: draft.modules.map(m => ({
            key: m.key,
            version: m.version,
            title: m.title,
            author: m.author,
            description: m.description,
            tags: m.tags,
            content_asset: m.content_asset,
            icon_asset: m.icon_asset,
            sort_order: m.sort_order,
        })),
        packs: draft.packs.map(p => ({
            key: p.key,
            version: p.version,
            title: p.title,
            author: p.author,
            description: p.description,
            tags: p.tags,
            mode: p.mode,
            project_asset: p.project_asset,
            icon_asset: p.icon_asset,
            sort_order: p.sort_order,
            items: p.items.map(it => ({ module_key: it.module_key, enabled: it.enabled })),
        })),
    };
}

function collectAssets(draft) {
    const out = new Map();
    const add = (asset) => {
        if (asset && !out.has(asset.sha256)) out.set(asset.sha256, publicAssetPath(asset));
    };
    for (const m of draft.modules) { add(m.content); add(m.icon); }
    for (const p of draft.packs) { add(p.project); add(p.icon); }
    return [...out.entries()].map(([sha256, path]) => ({ sha256, path }));
}

export function publish(db, config, workshopId, note = '', ip = '') {
    const draft = buildDraft(db, workshopId);
    const { errors, warnings } = validateDraft(draft, config);
    if (errors.length) {
        throw Object.assign(new Error(errors.join('；')), { status: 400, details: { errors, warnings } });
    }
    const w = draft.workshop;
    const fp = fingerprint(draft);
    if (w.published_revision > 0 && fp === w.published_fingerprint) {
        return { noChanges: true, revision: w.published_revision, warnings, sourceUrl: sourceUrl(config, w.slug) };
    }

    const revision = (w.published_revision || 0) + 1;
    const items = buildItems(draft, config, 'server');
    const manifest = buildManifest(draft, revision);
    const snapshot = snapshotOf(draft);
    const assets = collectAssets(draft);

    tx(db, () => {
        const current = db.prepare('SELECT published_revision, published_fingerprint FROM workshops WHERE id = ?').get(w.id);
        if (!current
            || current.published_revision !== w.published_revision
            || current.published_fingerprint !== w.published_fingerprint) {
            throw Object.assign(new Error('发布冲突：工坊已被另一处修改，请刷新后重试'), { status: 409 });
        }
        const result = db.prepare(`INSERT INTO releases
            (workshop_id, revision, fingerprint, manifest_json, items_json, snapshot_json, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(w.id, revision, fp, JSON.stringify(manifest), JSON.stringify(items), JSON.stringify(snapshot), String(note || ''), nowIso());
        const releaseId = Number(result.lastInsertRowid);
        const insertAsset = db.prepare('INSERT INTO release_assets (release_id, asset_sha, path) VALUES (?, ?, ?)');
        for (const a of assets) insertAsset.run(releaseId, a.sha256, a.path);
        db.prepare(`UPDATE workshops SET published_revision = ?, published_fingerprint = ?,
            draft_fingerprint = ?, updated_at = ? WHERE id = ?`)
            .run(revision, fp, fp, nowIso(), w.id);
        audit(db, 'publish', `${w.slug}@v${revision}`, ip, { note });
    });

    return {
        noChanges: false,
        revision,
        warnings,
        sourceUrl: sourceUrl(config, w.slug),
        manifest,
        items,
    };
}

export function rollback(db, config, workshopId, targetRevision, note = '', ip = '') {
    const w = db.prepare('SELECT * FROM workshops WHERE id = ? AND deleted_at IS NULL').get(Number(workshopId));
    if (!w) throw Object.assign(new Error('工坊不存在'), { status: 404 });
    const target = db.prepare('SELECT * FROM releases WHERE workshop_id = ? AND revision = ?').get(w.id, Number(targetRevision));
    if (!target) throw Object.assign(new Error('目标修订不存在'), { status: 404 });
    const revision = (w.published_revision || 0) + 1;
    const manifest = {
        format: 'pico-workshop',
        version: revision,
        name: w.name,
        updated: new Date().toISOString().slice(0, 10),
        url: w.items_mode === 'external' ? w.external_items_url : 'items.json',
    };
    const targetAssets = db.prepare('SELECT asset_sha, path FROM release_assets WHERE release_id = ?').all(target.id);

    tx(db, () => {
        const current = db.prepare('SELECT published_revision FROM workshops WHERE id = ?').get(w.id);
        if (!current || current.published_revision !== w.published_revision) {
            throw Object.assign(new Error('回滚冲突：工坊已被另一处修改，请刷新后重试'), { status: 409 });
        }
        const result = db.prepare(`INSERT INTO releases
            (workshop_id, revision, fingerprint, manifest_json, items_json, snapshot_json, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(w.id, revision, target.fingerprint, JSON.stringify(manifest), target.items_json, target.snapshot_json,
                String(note || `回滚自 v${target.revision}`), nowIso());
        const releaseId = Number(result.lastInsertRowid);
        const insertAsset = db.prepare('INSERT INTO release_assets (release_id, asset_sha, path) VALUES (?, ?, ?)');
        for (const a of targetAssets) insertAsset.run(releaseId, a.asset_sha, a.path);
        db.prepare('UPDATE workshops SET published_revision = ?, published_fingerprint = ?, updated_at = ? WHERE id = ?')
            .run(revision, target.fingerprint, nowIso(), w.id);
        audit(db, 'rollback', `${w.slug}@v${revision}<-v${target.revision}`, ip, { note });
    });
    return { revision, sourceUrl: sourceUrl(config, w.slug), from: target.revision };
}
