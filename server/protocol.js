// ---------------------------------------------------------------------------
// 工坊协议生成/校验。协议权威：pico-hid-mapper/docs/LUA_WORKSHOP.md。
// 这里只负责把草稿结构变成 ws.json / items.json；不碰 HTTP。
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { readAsset, publicAssetPath, base64, dataUrl } from './store.js';

export const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const RESERVED_SLUGS = new Set(['api', 'w', 'assets', 'healthz', 'login', 'admin', 'p', 'settings', 'favicon.ico']);
export const MANIFEST_MAX = 64 * 1024;
export const ITEMS_MAX = 512 * 1024;
export const PROJECT_FORMAT = 'pico-lua-project';

export function slugError(slug) {
    const s = String(slug || '').trim();
    if (!SLUG_RE.test(s)) return 'slug 只能是小写字母/数字/连字符，且以字母或数字开头';
    if (RESERVED_SLUGS.has(s)) return `slug 不能使用保留字：${s}`;
    return '';
}

export function getWorkshop(db, id) {
    return db.prepare('SELECT * FROM workshops WHERE id = ? AND deleted_at IS NULL').get(Number(id)) || null;
}

export function getWorkshopBySlug(db, slug) {
    return db.prepare('SELECT * FROM workshops WHERE slug = ? AND deleted_at IS NULL').get(String(slug)) || null;
}

export function sourceUrl(config, slug) {
    return `${config.publicBaseUrl}/w/${slug}/ws.json`;
}

function parseTags(json) {
    try {
        const v = JSON.parse(json || '[]');
        return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
    } catch { return []; }
}

/** 草稿结构：workshop + modules + packs（含有序引用）+ 资源表。 */
export function buildDraft(db, workshopId) {
    const workshop = getWorkshop(db, workshopId);
    if (!workshop) throw Object.assign(new Error('工坊不存在'), { status: 404 });
    const modules = db.prepare('SELECT * FROM modules WHERE workshop_id = ? ORDER BY sort_order, id').all(workshop.id);
    const packs = db.prepare('SELECT * FROM packs WHERE workshop_id = ? ORDER BY sort_order, id').all(workshop.id);
    const assets = new Map(db.prepare('SELECT * FROM assets').all().map(a => [a.sha256, a]));

    const modulesOut = modules.map(m => ({
        ...m,
        tags: parseTags(m.tags_json),
        content: m.content_asset ? assets.get(m.content_asset) : null,
        icon: m.icon_asset ? assets.get(m.icon_asset) : null,
    }));
    const byId = new Map(modulesOut.map(m => [m.id, m]));
    const packsOut = packs.map(p => {
        const refs = db.prepare(`SELECT pi.*, m.key AS module_key FROM pack_items pi
            JOIN modules m ON m.id = pi.module_id
            WHERE pi.pack_id = ? ORDER BY pi.position`).all(p.id);
        return {
            ...p,
            tags: parseTags(p.tags_json),
            icon: p.icon_asset ? assets.get(p.icon_asset) : null,
            project: p.project_asset ? assets.get(p.project_asset) : null,
            items: refs.map(r => ({
                module_id: r.module_id,
                module_key: byId.get(r.module_id)?.key || r.module_key,
                enabled: !!r.enabled,
            })),
        };
    });
    return { workshop, modules: modulesOut, packs: packsOut, assets };
}

/** 发布快照 → 草稿结构（用于 published 导出与校验）。 */
export function draftFromSnapshot(db, snapshot) {
    const assets = new Map(db.prepare('SELECT * FROM assets').all().map(a => [a.sha256, a]));
    const modules = (snapshot.modules || []).map(m => ({
        ...m,
        tags: Array.isArray(m.tags) ? m.tags : [],
        content: m.content_asset ? assets.get(m.content_asset) : null,
        icon: m.icon_asset ? assets.get(m.icon_asset) : null,
    }));
    const packs = (snapshot.packs || []).map(p => ({
        ...p,
        tags: Array.isArray(p.tags) ? p.tags : [],
        icon: p.icon_asset ? assets.get(p.icon_asset) : null,
        project: p.project_asset ? assets.get(p.project_asset) : null,
        items: Array.isArray(p.items) ? p.items : [],
    }));
    return { workshop: { ...snapshot.workshop }, modules, packs, assets };
}

export function parseProjectText(text) {
    let obj;
    try { obj = JSON.parse(String(text).replace(/^﻿/, '')); }
    catch (e) { throw new Error(`项目文件不是合法 JSON：${e.message}`); }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.format !== PROJECT_FORMAT) {
        throw new Error('项目文件缺少 pico-lua-project 标记');
    }
    if (!Array.isArray(obj.modules)) throw new Error('项目文件缺少 modules 数组');
    const modules = obj.modules.map((m, i) => {
        if (!m || typeof m !== 'object' || typeof m.name !== 'string' || !m.name.trim()) {
            throw new Error(`项目文件第 ${i + 1} 个模块缺少名称`);
        }
        if (typeof m.code !== 'string') throw new Error(`项目文件模块「${m.name}」缺少 code`);
        return { name: m.name, code: m.code, enabled: m.enabled !== false };
    });
    return { name: typeof obj.name === 'string' ? obj.name : '', modules };
}

/** 发布前校验；返回 {errors, warnings}。 */
export function validateDraft(draft, config) {
    const errors = [];
    const warnings = [];
    const w = draft.workshop;
    if (!String(w.name || '').trim()) errors.push('工坊名称不能为空');
    if (!String(w.slug || '').trim()) errors.push('工坊 slug 不能为空');
    if (w.items_mode === 'external') {
        try {
            const u = new URL(w.external_items_url);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
        } catch {
            errors.push('托管模式为外部 CDN 时，必须填写完整的 http/https items 地址');
        }
    }

    const moduleKeys = new Set();
    let totalBytes = 0;
    for (const m of draft.modules) {
        const label = `模块「${m.key || m.id}」`;
        if (!ID_RE.test(String(m.key || ''))) errors.push(`${label} 的 id 不合法`);
        if (moduleKeys.has(m.key)) errors.push(`${label} 的 id 重复`);
        moduleKeys.add(m.key);
        if (!String(m.title || '').trim()) errors.push(`${label} 缺少 title`);
        if (!String(m.version || '').trim()) errors.push(`${label} 缺少 version`);
        if (!m.content) errors.push(`${label} 还没有脚本内容`);
        if (m.icon && m.icon.kind !== 'icon') errors.push(`${label} 的图标资源类型不对`);
        if (m.content) totalBytes += m.content.size_bytes;
    }
    for (const p of draft.packs) {
        const label = `整合包「${p.key || p.id}」`;
        if (!ID_RE.test(String(p.key || ''))) errors.push(`${label} 的 id 不合法`);
        if (!String(p.title || '').trim()) errors.push(`${label} 缺少 title`);
        if (!String(p.version || '').trim()) errors.push(`${label} 缺少 version`);
        if (p.mode === 'refs') {
            if (!p.items.length) errors.push(`${label} 没有引用任何模块`);
            const seen = new Set();
            for (const it of p.items) {
                if (!moduleKeys.has(it.module_key)) errors.push(`${label} 引用了不存在的模块：${it.module_key}`);
                if (seen.has(it.module_key)) errors.push(`${label} 重复引用了模块：${it.module_key}`);
                seen.add(it.module_key);
            }
        } else if (p.mode === 'file') {
            if (!p.project) errors.push(`${label} 还没有上传 .luaproj`);
            else {
                try { parseProjectText(readAsset(config, p.project).toString('utf8')); }
                catch (e) { errors.push(`${label} 的 .luaproj 无效：${e.message}`); }
            }
        } else {
            errors.push(`${label} 的内容模式不合法`);
        }
        if (p.icon && p.icon.kind !== 'icon') errors.push(`${label} 的图标资源类型不对`);
    }
    if (draft.modules.length > 32) warnings.push(`模块数 ${draft.modules.length} 超过当前固件上限 32；仍可发布，导入到设备时会受限`);
    if (totalBytes > 64 * 1024) warnings.push(`模块内容合计 ${totalBytes} 字节，超过当前固件 64KB 限制；导入到设备时会受限`);

    if (!errors.length) {
        try {
            const items = buildItems(draft, config, 'server');
            const itemsJson = JSON.stringify(items);
            if (Buffer.byteLength(itemsJson) > ITEMS_MAX) errors.push(`items.json 序列化后 ${Buffer.byteLength(itemsJson)} 字节，超过 ${ITEMS_MAX} 上限`);
            const manifest = buildManifest(draft, Math.max(1, w.published_revision + 1));
            if (Buffer.byteLength(JSON.stringify(manifest)) > MANIFEST_MAX) errors.push('目录头超过 64KB');
        } catch (e) {
            errors.push(e.message);
        }
    }
    return { errors, warnings };
}

function urlForAsset(config, draft, asset, representation, kind, key) {
    if (!asset) return '';
    if (representation === 'inline') {
        return dataUrl(asset, readAsset(config, asset));
    }
    if (representation === 'icons' && kind === 'icon') {
        return dataUrl(asset, readAsset(config, asset));
    }
    if (representation === 'zip') {
        if (kind === 'icon') return `icons/${key}.${asset.ext}`;
        if (kind === 'script') return `scripts/${key}.lua`;
        return `packs/${key}.luaproj`;
    }
    if (representation === 'icons') {
        return `${config.publicBaseUrl}/w/${draft.workshop.slug}/${publicAssetPath(asset)}`;
    }
    return publicAssetPath(asset);
}

/** 生成 items。representation: server | zip | icons | inline。 */
export function buildItems(draft, config, representation = 'server') {
    const modules = draft.modules.map(m => {
        const item = {
            id: m.key,
            version: m.version,
            title: m.title,
        };
        if (m.author) item.author = m.author;
        if (m.description) item.description = m.description;
        if (m.tags && m.tags.length) item.tags = m.tags;
        if (m.icon) item.icon = urlForAsset(config, draft, m.icon, representation, 'icon', m.key);
        if (m.content) {
            item.size = m.content.size_bytes;
            if (representation === 'inline') item.inlineBase64 = base64(readAsset(config, m.content));
            else item.url = urlForAsset(config, draft, m.content, representation, 'script', m.key);
        }
        return item;
    });

    const packs = draft.packs.map(p => {
        const item = {
            id: p.key,
            version: p.version,
            title: p.title,
        };
        if (p.author) item.author = p.author;
        if (p.description) item.description = p.description;
        if (p.tags && p.tags.length) item.tags = p.tags;
        if (p.icon) item.icon = urlForAsset(config, draft, p.icon, representation, 'icon', p.key);
        if (p.mode === 'refs') {
            item.items = p.items.map(it => (it.enabled ? it.module_key : { id: it.module_key, enabled: false }));
        } else {
            if (p.project) {
                item.size = p.project.size_bytes;
                if (representation === 'inline') item.inlineBase64 = base64(readAsset(config, p.project));
                else item.url = urlForAsset(config, draft, p.project, representation, 'project', p.key);
            }
        }
        return item;
    });

    return { modules, packs };
}

/** 生成目录头。urlOverride 用于导出静态包时强制 url="items.json"。 */
export function buildManifest(draft, revision, { urlOverride = null } = {}) {
    const w = draft.workshop;
    const url = urlOverride
        || (w.items_mode === 'external' ? w.external_items_url : 'items.json');
    return {
        format: 'pico-workshop',
        version: revision,
        name: w.name,
        updated: new Date().toISOString().slice(0, 10),
        url,
    };
}

/** 内容指纹：不含 updated/DB id，确保同内容不重复递增 revision。 */
export function fingerprint(draft) {
    const canonical = {
        name: draft.workshop.name,
        itemsMode: draft.workshop.items_mode,
        externalItemsUrl: draft.workshop.external_items_url,
        modules: draft.modules.map(m => ({
            key: m.key,
            version: m.version,
            title: m.title,
            author: m.author,
            description: m.description,
            tags: m.tags,
            content: m.content_asset || '',
            icon: m.icon_asset || '',
            order: m.sort_order,
        })),
        packs: draft.packs.map(p => ({
            key: p.key,
            version: p.version,
            title: p.title,
            author: p.author,
            description: p.description,
            tags: p.tags,
            mode: p.mode,
            project: p.project_asset || '',
            icon: p.icon_asset || '',
            items: p.items.map(it => ({ key: it.module_key, enabled: it.enabled })),
            order: p.sort_order,
        })),
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
