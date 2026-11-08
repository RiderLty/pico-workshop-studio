// ---------------------------------------------------------------------------
// 导出：ZIP（分离文件）/ JSON（仅图标内联）/ JSON（全部内联）。
// 导出档位与服务器托管模式解耦，从同一份发布快照生成。
// ---------------------------------------------------------------------------
import { zipSync, strToU8 } from 'fflate';
import {
    buildDraft, draftFromSnapshot, buildItems, buildManifest, sourceUrl, validateDraft, ITEMS_MAX,
} from './protocol.js';
import { readAsset } from './store.js';

export const EXPORT_LEVELS = ['zip', 'icons', 'inline'];

function currentRelease(db, workshopId) {
    const w = db.prepare('SELECT * FROM workshops WHERE id = ? AND deleted_at IS NULL').get(Number(workshopId));
    if (!w) throw Object.assign(new Error('工坊不存在'), { status: 404 });
    if (!w.published_revision) throw Object.assign(new Error('还没有发布过，无法导出已发布版本'), { status: 404 });
    const release = db.prepare('SELECT * FROM releases WHERE workshop_id = ? AND revision = ?')
        .get(w.id, w.published_revision);
    if (!release) throw Object.assign(new Error('发布记录缺失'), { status: 500 });
    return { workshop: w, release };
}

export function draftForSource(db, config, workshopId, source) {
    if (source === 'published') {
        const { release } = currentRelease(db, workshopId);
        return { draft: draftFromSnapshot(db, JSON.parse(release.snapshot_json)), revision: release.revision };
    }
    const draft = buildDraft(db, workshopId);
    return { draft, revision: Math.max(1, (draft.workshop.published_revision || 0) + 1) };
}

function readme(draft, config, level) {
    const lines = [
        `# ${draft.workshop.name} 工坊导出`,
        '',
        `- 导出档位：${level}`,
        `- 目录头：ws.json；目录内容：items.json`,
        '- 上传到支持跨域的静态托管（响应头需要 Access-Control-Allow-Origin: *）',
        `- 发布源地址（本服务器）：${sourceUrl(config, draft.workshop.slug)}`,
    ];
    if (level === 'zip') {
        lines.push('- 本 ZIP 已包含 scripts/、icons/、packs/，把整个目录一起上传即可。');
    } else if (level === 'icons') {
        lines.push('- 图标已内联；脚本/整合包文件仍指向本服务器 assets，请保持“公开 assets”开启，或改用 zip 档位。');
    } else {
        lines.push('- 脚本与图标全部内联，只需上传 ws.json 与 items.json；items.json 就是单文件内容源。');
    }
    return lines.join('\n') + '\n';
}

export function buildExport(db, config, workshopId, { source = 'published', level = 'zip' } = {}) {
    if (!EXPORT_LEVELS.includes(level)) {
        throw Object.assign(new Error(`未知导出档位：${level}`), { status: 400 });
    }
    const { draft, revision } = draftForSource(db, config, workshopId, source);
    if (source !== 'published') {
        const v = validateDraft(draft, config);
        if (v.errors.length) {
            throw Object.assign(new Error(`草稿还不能导出：${v.errors.join('；')}`), { status: 400, details: v });
        }
    }
    const representation = level === 'zip' ? 'zip' : level;
    const items = buildItems(draft, config, representation);
    // 协议上限按实际字节计；导出用紧凑 JSON，给 512KB 留足余量。
    const itemsJson = JSON.stringify(items);
    if (Buffer.byteLength(itemsJson) > ITEMS_MAX) {
        throw Object.assign(new Error(`items.json 约 ${Buffer.byteLength(itemsJson)} 字节，超过 ${ITEMS_MAX} 上限；请改用 zip 档位或缩小内联内容`), { status: 400 });
    }
    const ws = buildManifest(draft, revision, { urlOverride: 'items.json' });
    const wsJson = JSON.stringify(ws, null, 2);

    const files = {
        'ws.json': strToU8(wsJson),
        'items.json': strToU8(itemsJson),
        'README.md': strToU8(readme(draft, config, level)),
    };
    if (level === 'zip') {
        for (const m of draft.modules) {
            if (m.content) files[`scripts/${m.key}.lua`] = readAsset(config, m.content);
            if (m.icon) files[`icons/${m.key}.${m.icon.ext}`] = readAsset(config, m.icon);
        }
        for (const p of draft.packs) {
            if (p.project) files[`packs/${p.key}.luaproj`] = readAsset(config, p.project);
            if (p.icon) files[`icons/${p.key}.${p.icon.ext}`] = readAsset(config, p.icon);
        }
    }
    return { ws, items, wsJson, itemsJson, files, revision };
}

export function exportZip(db, config, workshopId, opts) {
    const { files } = buildExport(db, config, workshopId, opts);
    return zipSync(files, { level: 6 });
}
