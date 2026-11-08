// ---------------------------------------------------------------------------
// HTTP 路由：管理 API（/api，需登录 + CSRF）、公开只读（/w，CORS *）、SPA 静态。
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { nowIso, getSetting, setSetting, audit } from './db.js';
import {
    adminUsername, authVersion, checkLoginRate, clearLoginFailures, clearSessionCookie,
    clientIp, csrfFor, ensureAdmin, hashPassword, issueSession, readSession,
    recordLoginFailure, setSessionCookie, verifyPassword, dummyVerify,
} from './auth.js';
import {
    ID_RE, buildDraft, fingerprint, getWorkshop, getWorkshopBySlug, sourceUrl, slugError,
    validateDraft, parseProjectText,
} from './protocol.js';
import { publish, rollback } from './publish.js';
import { buildExport, exportZip, EXPORT_LEVELS } from './export.js';
import { getAsset, readAsset, saveAsset } from './store.js';

const APP_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const MAX_SCRIPT = 1024 * 1024;
const MAX_ICON = 256 * 1024;

const httpError = (status, message, details) => Object.assign(new Error(message), { status, details });

function jsonBody(c) {
    return c.req.json().catch(() => ({}));
}

async function bodyBuffer(c, max, label) {
    const len = Number(c.req.header('content-length') || 0);
    if (len > max) throw httpError(413, `${label}超过 ${Math.round(max / 1024)}KB 上限`);
    const buf = Buffer.from(await c.req.arrayBuffer());
    if (!buf.length) throw httpError(400, `${label}为空`);
    if (buf.length > max) throw httpError(413, `${label}超过 ${Math.round(max / 1024)}KB 上限`);
    return buf;
}

function parseTags(raw) {
    if (Array.isArray(raw)) return raw.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, 20);
    return [];
}

function text(v, max = 8000) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function workshopOut(db, config, w) {
    const moduleCount = db.prepare('SELECT COUNT(*) AS c FROM modules WHERE workshop_id = ?').get(w.id).c;
    const packCount = db.prepare('SELECT COUNT(*) AS c FROM packs WHERE workshop_id = ?').get(w.id).c;
    return {
        id: w.id,
        slug: w.slug,
        name: w.name,
        description: w.description,
        itemsMode: w.items_mode,
        externalItemsUrl: w.external_items_url,
        serveItems: !!w.serve_items,
        serveAssets: !!w.serve_assets,
        publishedRevision: w.published_revision,
        draftDirty: w.draft_fingerprint !== w.published_fingerprint,
        moduleCount,
        packCount,
        sourceUrl: sourceUrl(config, w.slug),
        createdAt: w.created_at,
        updatedAt: w.updated_at,
    };
}

function touchDraft(db, workshopId) {
    const draft = buildDraft(db, workshopId);
    db.prepare('UPDATE workshops SET draft_fingerprint = ?, updated_at = ? WHERE id = ?')
        .run(fingerprint(draft), nowIso(), workshopId);
}

function moduleOut(db, m) {
    const content = m.content_asset ? getAsset(db, m.content_asset) : null;
    const packs = db.prepare(`SELECT p.key FROM pack_items pi JOIN packs p ON p.id = pi.pack_id
        WHERE pi.module_id = ? ORDER BY p.sort_order, p.id`).all(m.id).map(r => r.key);
    return {
        id: m.id,
        key: m.key,
        title: m.title,
        version: m.version,
        author: m.author,
        description: m.description,
        tags: JSON.parse(m.tags_json || '[]'),
        contentAsset: m.content_asset,
        contentSize: content ? content.size_bytes : 0,
        iconAsset: m.icon_asset,
        iconUrl: m.icon_asset ? `/api/assets/${m.icon_asset}` : '',
        sortOrder: m.sort_order,
        referencedBy: packs,
        updatedAt: m.updated_at,
    };
}

function packOut(db, p) {
    const items = db.prepare(`SELECT pi.module_id, pi.enabled, m.key AS module_key
        FROM pack_items pi JOIN modules m ON m.id = pi.module_id
        WHERE pi.pack_id = ? ORDER BY pi.position`).all(p.id);
    const project = p.project_asset ? getAsset(db, p.project_asset) : null;
    return {
        id: p.id,
        key: p.key,
        title: p.title,
        version: p.version,
        author: p.author,
        description: p.description,
        tags: JSON.parse(p.tags_json || '[]'),
        mode: p.mode,
        projectAsset: p.project_asset,
        projectSize: project ? project.size_bytes : 0,
        iconAsset: p.icon_asset,
        iconUrl: p.icon_asset ? `/api/assets/${p.icon_asset}` : '',
        sortOrder: p.sort_order,
        items: items.map(it => ({ moduleId: it.module_id, moduleKey: it.module_key, enabled: !!it.enabled })),
        updatedAt: p.updated_at,
    };
}

function updateRow(db, table, id, fields, allowed) {
    const sets = [];
    const params = [];
    for (const [k, col] of Object.entries(allowed)) {
        if (!(k in fields)) continue;
        sets.push(`${col} = ?`);
        params.push(k === 'tags' ? JSON.stringify(parseTags(fields[k])) : fields[k]);
    }
    if (!sets.length) return false;
    sets.push('updated_at = ?');
    params.push(nowIso(), id);
    db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return true;
}

function parseAssetFile(file) {
    const m = /^([a-f0-9]{64})\.([a-z0-9]+)$/.exec(String(file || ''));
    if (!m) return null;
    return { sha: m[1], ext: m[2] };
}

export function createApp({ db, config }) {
    ensureAdmin(db, config);
    const app = new Hono();

    // ── 安全头 ──
    app.use('*', async (c, next) => {
        await next();
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('X-Frame-Options', 'DENY');
        c.header('Referrer-Policy', 'same-origin');
    });

    // ── 公开工坊路由：CORS *（管理 API 绝不加）──
    // 注意：公开 handler 可能返回 `new Response(...)`；Hono 的 c.header 只有在
    // next() 之后写才会落到最终 Response 上，写在 next() 之前会被裸 Response 覆盖。
    app.use('/w/*', async (c, next) => {
        if (c.req.method === 'OPTIONS') {
            return c.body(null, 204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
                'Access-Control-Expose-Headers': 'Content-Length,ETag',
            });
        }
        await next();
        c.header('Access-Control-Allow-Origin', '*');
        c.header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
        c.header('Access-Control-Expose-Headers', 'Content-Length,ETag');
    });

    // ── 管理 API 鉴权 + CSRF + Origin ──
    app.use('/api/*', async (c, next) => {
        if (c.req.method === 'OPTIONS') return c.body(null, 204);
        if (c.req.path === '/api/auth/login') return next();
        const session = readSession(c, db, config);
        if (!session) return c.json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401);
        c.set('session', session);
        if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
            const origin = c.req.header('origin')
                || (c.req.header('referer') ? new URL(c.req.header('referer')).origin : '');
            if (!origin || !config.allowedOrigins.has(origin)) {
                return c.json({ error: { code: 'BAD_ORIGIN', message: '请求来源不被允许' } }, 403);
            }
            const token = c.req.header('x-csrf-token') || '';
            if (token !== csrfFor(session.jti, config.sessionSecret)) {
                return c.json({ error: { code: 'BAD_CSRF', message: 'CSRF 校验失败，请刷新页面' } }, 403);
            }
        }
        return next();
    });

    // ── 认证 ──
    app.post('/api/auth/login', async (c) => {
        const origin = c.req.header('origin');
        if (origin && !config.allowedOrigins.has(origin)) {
            return c.json({ error: { code: 'BAD_ORIGIN', message: '请求来源不被允许' } }, 403);
        }
        const body = await jsonBody(c);
        const ip = clientIp(c, config);
        checkLoginRate(ip);
        const username = text(body.username, 80);
        const password = String(body.password || '');
        const stored = getSetting(db, 'admin.password_hash', '');
        const expected = adminUsername(db);
        if (!stored || username !== expected || !verifyPassword(password, stored)) {
            recordLoginFailure(ip);
            if (!stored) dummyVerify();
            audit(db, 'login.failure', username, ip);
            return c.json({ error: { code: 'BAD_CREDENTIALS', message: '用户名或密码错误' } }, 401);
        }
        clearLoginFailures(ip);
        const s = issueSession(db, config);
        setSessionCookie(c, s.cookie, config);
        audit(db, 'login.success', username, ip);
        return c.json({ username: expected, csrfToken: s.csrfToken, expiresAt: s.expiresAt });
    });

    app.post('/api/auth/logout', (c) => {
        clearSessionCookie(c);
        return c.json({ ok: true });
    });

    app.get('/api/auth/session', (c) => {
        const s = c.get('session');
        return c.json({
            username: adminUsername(db),
            csrfToken: csrfFor(s.jti, config.sessionSecret),
            expiresAt: s.exp,
        });
    });

    app.post('/api/auth/password', async (c) => {
        const body = await jsonBody(c);
        const stored = getSetting(db, 'admin.password_hash', '');
        if (!verifyPassword(String(body.currentPassword || ''), stored)) {
            return c.json({ error: { code: 'BAD_PASSWORD', message: '当前密码不正确' } }, 400);
        }
        const next = String(body.newPassword || '');
        if (next.length < 12) {
            return c.json({ error: { code: 'WEAK_PASSWORD', message: '新密码至少 12 个字符' } }, 400);
        }
        setSetting(db, 'admin.password_hash', hashPassword(next));
        setSetting(db, 'admin.auth_version', authVersion(db) + 1);
        clearSessionCookie(c);
        audit(db, 'password.change', 'admin', clientIp(c, config));
        return c.json({ ok: true });
    });

    // ── 工坊 ──
    app.get('/api/workshops', (c) => {
        const rows = db.prepare('SELECT * FROM workshops WHERE deleted_at IS NULL ORDER BY id').all();
        return c.json({ workshops: rows.map(w => workshopOut(db, config, w)) });
    });

    app.post('/api/workshops', async (c) => {
        const body = await jsonBody(c);
        const slug = text(body.slug, 64).toLowerCase();
        const name = text(body.name, 80);
        const err = slugError(slug);
        if (err) return c.json({ error: { code: 'BAD_SLUG', message: err } }, 400);
        if (!name) return c.json({ error: { code: 'BAD_NAME', message: '工坊名称不能为空' } }, 400);
        if (db.prepare('SELECT id FROM workshops WHERE slug = ?').get(slug)) {
            return c.json({ error: { code: 'SLUG_TAKEN', message: 'slug 已存在' } }, 409);
        }
        const now = nowIso();
        const r = db.prepare(`INSERT INTO workshops (slug, name, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)`).run(slug, name, text(body.description), now, now);
        const id = Number(r.lastInsertRowid);
        touchDraft(db, id);
        audit(db, 'workshop.create', slug, clientIp(c, config));
        return c.json({ workshop: workshopOut(db, config, getWorkshop(db, id)) }, 201);
    });

    app.get('/api/workshops/:id', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        return c.json({ workshop: workshopOut(db, config, w) });
    });

    app.patch('/api/workshops/:id', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const body = await jsonBody(c);
        if (body.baseUpdatedAt && body.baseUpdatedAt !== w.updated_at) {
            return c.json({ error: { code: 'CONFLICT', message: '工坊已被另一处修改，请刷新后重试' } }, 409);
        }
        const name = body.name === undefined ? w.name : text(body.name, 80);
        if (!name) return c.json({ error: { code: 'BAD_NAME', message: '工坊名称不能为空' } }, 400);
        const description = body.description === undefined ? w.description : text(body.description);
        db.prepare('UPDATE workshops SET name = ?, description = ?, updated_at = ? WHERE id = ?')
            .run(name, description, nowIso(), w.id);
        touchDraft(db, w.id);
        audit(db, 'workshop.update', w.slug, clientIp(c, config));
        return c.json({ workshop: workshopOut(db, config, getWorkshop(db, w.id)) });
    });

    app.patch('/api/workshops/:id/hosting', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const body = await jsonBody(c);
        const mode = body.itemsMode === undefined ? w.items_mode : String(body.itemsMode);
        if (mode !== 'server' && mode !== 'external') {
            return c.json({ error: { code: 'BAD_MODE', message: 'items_mode 只能是 server 或 external' } }, 400);
        }
        const external = body.externalItemsUrl === undefined ? w.external_items_url : text(body.externalItemsUrl, 2000);
        if (mode === 'external') {
            try {
                const u = new URL(external);
                if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
            } catch {
                return c.json({ error: { code: 'BAD_URL', message: '外部 items 地址必须是完整的 http/https 地址' } }, 400);
            }
        }
        db.prepare('UPDATE workshops SET items_mode = ?, external_items_url = ?, updated_at = ? WHERE id = ?')
            .run(mode, external, nowIso(), w.id);
        touchDraft(db, w.id);
        audit(db, 'workshop.hosting', w.slug, clientIp(c, config), { mode, external });
        return c.json({ workshop: workshopOut(db, config, getWorkshop(db, w.id)) });
    });

    app.patch('/api/workshops/:id/visibility', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const body = await jsonBody(c);
        const si = body.serveItems === undefined ? !!w.serve_items : !!body.serveItems;
        const sa = body.serveAssets === undefined ? !!w.serve_assets : !!body.serveAssets;
        db.prepare('UPDATE workshops SET serve_items = ?, serve_assets = ?, updated_at = ? WHERE id = ?')
            .run(si ? 1 : 0, sa ? 1 : 0, nowIso(), w.id);
        audit(db, 'workshop.visibility', w.slug, clientIp(c, config), { serveItems: si, serveAssets: sa });
        return c.json({ workshop: workshopOut(db, config, getWorkshop(db, w.id)) });
    });

    app.delete('/api/workshops/:id', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const body = await jsonBody(c);
        if (body.confirmSlug !== w.slug) {
            return c.json({ error: { code: 'CONFIRM_REQUIRED', message: `请传入 confirmSlug=${w.slug}` } }, 400);
        }
        db.prepare('UPDATE workshops SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), w.id);
        audit(db, 'workshop.delete', w.slug, clientIp(c, config));
        return c.json({ ok: true });
    });

    app.get('/api/workshops/:id/validation', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const draft = buildDraft(db, w.id);
        return c.json(validateDraft(draft, config));
    });

    // ── 模块 ──
    app.get('/api/workshops/:id/modules', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const rows = db.prepare('SELECT * FROM modules WHERE workshop_id = ? ORDER BY sort_order, id').all(w.id);
        return c.json({ modules: rows.map(m => moduleOut(db, m)) });
    });

    app.post('/api/workshops/:id/modules', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const body = await jsonBody(c);
        const key = text(body.key, 64);
        if (!ID_RE.test(key)) return c.json({ error: { code: 'BAD_ID', message: '模块 id 不合法' } }, 400);
        if (db.prepare('SELECT id FROM modules WHERE workshop_id = ? AND key = ?').get(w.id, key)) {
            return c.json({ error: { code: 'ID_TAKEN', message: '模块 id 已存在' } }, 409);
        }
        const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM modules WHERE workshop_id = ?').get(w.id).m;
        const now = nowIso();
        const r = db.prepare(`INSERT INTO modules
            (workshop_id, key, version, title, author, description, tags_json, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            w.id, key, text(body.version, 40), text(body.title, 120), text(body.author, 80),
            text(body.description), JSON.stringify(parseTags(body.tags)), max + 10, now, now,
        );
        touchDraft(db, w.id);
        const m = db.prepare('SELECT * FROM modules WHERE id = ?').get(Number(r.lastInsertRowid));
        return c.json({ module: moduleOut(db, m) }, 201);
    });

    app.get('/api/workshops/:id/modules/:moduleId', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        const m = db.prepare('SELECT * FROM modules WHERE id = ? AND workshop_id = ?').get(Number(c.req.param('moduleId')), w?.id);
        if (!w || !m) return c.json({ error: { code: 'NOT_FOUND', message: '模块不存在' } }, 404);
        const content = m.content_asset ? getAsset(db, m.content_asset) : null;
        let code = '';
        if (content) code = readAsset(config, content).toString('utf8');
        return c.json({ module: moduleOut(db, m), code });
    });

    app.patch('/api/workshops/:id/modules/:moduleId', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        const m = db.prepare('SELECT * FROM modules WHERE id = ? AND workshop_id = ?').get(Number(c.req.param('moduleId')), w?.id);
        if (!w || !m) return c.json({ error: { code: 'NOT_FOUND', message: '模块不存在' } }, 404);
        const body = await jsonBody(c);
        if (body.key !== undefined) {
            const key = text(body.key, 64);
            if (!ID_RE.test(key)) return c.json({ error: { code: 'BAD_ID', message: '模块 id 不合法' } }, 400);
            const dup = db.prepare('SELECT id FROM modules WHERE workshop_id = ? AND key = ? AND id <> ?').get(w.id, key, m.id);
            if (dup) return c.json({ error: { code: 'ID_TAKEN', message: '模块 id 已存在' } }, 409);
            body.key = key;
        }
        updateRow(db, 'modules', m.id, body, {
            key: 'key', version: 'version', title: 'title', author: 'author', description: 'description', tags: 'tags_json',
        });
        touchDraft(db, w.id);
        return c.json({ module: moduleOut(db, db.prepare('SELECT * FROM modules WHERE id = ?').get(m.id)) });
    });

    app.delete('/api/workshops/:id/modules/:moduleId', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        const m = db.prepare('SELECT * FROM modules WHERE id = ? AND workshop_id = ?').get(Number(c.req.param('moduleId')), w?.id);
        if (!w || !m) return c.json({ error: { code: 'NOT_FOUND', message: '模块不存在' } }, 404);
        const refs = db.prepare(`SELECT p.key FROM pack_items pi JOIN packs p ON p.id = pi.pack_id WHERE pi.module_id = ?`).all(m.id);
        if (refs.length) {
            return c.json({
                error: { code: 'REFERENCED', message: `模块被整合包引用：${refs.map(r => r.key).join(', ')}` },
                packs: refs.map(r => r.key),
            }, 409);
        }
        db.prepare('DELETE FROM modules WHERE id = ?').run(m.id);
        touchDraft(db, w.id);
        audit(db, 'module.delete', `${w.slug}/${m.key}`, clientIp(c, config));
        return c.json({ ok: true });
    });

    app.put('/api/workshops/:id/modules/:moduleId/content', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        const m = db.prepare('SELECT * FROM modules WHERE id = ? AND workshop_id = ?').get(Number(c.req.param('moduleId')), w?.id);
        if (!w || !m) return c.json({ error: { code: 'NOT_FOUND', message: '模块不存在' } }, 404);
        const buf = await bodyBuffer(c, MAX_SCRIPT, '脚本');
        const asset = saveAsset(db, config, { buffer: buf, kind: 'script' });
        db.prepare('UPDATE modules SET content_asset = ?, updated_at = ? WHERE id = ?').run(asset.sha256, nowIso(), m.id);
        touchDraft(db, w.id);
        return c.json({ sha256: asset.sha256, size: asset.size_bytes });
    });

    app.post('/api/workshops/:id/modules/:moduleId/icon', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        const m = db.prepare('SELECT * FROM modules WHERE id = ? AND workshop_id = ?').get(Number(c.req.param('moduleId')), w?.id);
        if (!w || !m) return c.json({ error: { code: 'NOT_FOUND', message: '模块不存在' } }, 404);
        const buf = await bodyBuffer(c, MAX_ICON, '图标');
        const asset = saveAsset(db, config, { buffer: buf, kind: 'icon' });
        db.prepare('UPDATE modules SET icon_asset = ?, updated_at = ? WHERE id = ?').run(asset.sha256, nowIso(), m.id);
        touchDraft(db, w.id);
        return c.json({ sha256: asset.sha256, size: asset.size_bytes, mime: asset.mime });
    });

    app.post('/api/workshops/:id/modules/reorder', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const body = await jsonBody(c);
        const order = Array.isArray(body.order) ? body.order.map(Number) : [];
        const existing = db.prepare('SELECT id FROM modules WHERE workshop_id = ?').all(w.id).map(r => r.id);
        if (order.length !== existing.length || new Set(order).size !== order.length
            || order.some(id => !existing.includes(id))) {
            return c.json({ error: { code: 'BAD_ORDER', message: '排序列表必须包含全部模块且不重复' } }, 400);
        }
        const stmt = db.prepare('UPDATE modules SET sort_order = ?, updated_at = ? WHERE id = ?');
        order.forEach((id, i) => stmt.run((i + 1) * 10, nowIso(), id));
        touchDraft(db, w.id);
        return c.json({ ok: true });
    });

    // ── 整合包 ──
    app.get('/api/workshops/:id/packs', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const rows = db.prepare('SELECT * FROM packs WHERE workshop_id = ? ORDER BY sort_order, id').all(w.id);
        return c.json({ packs: rows.map(p => packOut(db, p)) });
    });

    app.post('/api/workshops/:id/packs', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const body = await jsonBody(c);
        const key = text(body.key, 64);
        if (!ID_RE.test(key)) return c.json({ error: { code: 'BAD_ID', message: '整合包 id 不合法' } }, 400);
        if (db.prepare('SELECT id FROM packs WHERE workshop_id = ? AND key = ?').get(w.id, key)) {
            return c.json({ error: { code: 'ID_TAKEN', message: '整合包 id 已存在' } }, 409);
        }
        const mode = body.mode === 'file' ? 'file' : 'refs';
        const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM packs WHERE workshop_id = ?').get(w.id).m;
        const now = nowIso();
        const r = db.prepare(`INSERT INTO packs
            (workshop_id, key, version, title, author, description, tags_json, mode, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            w.id, key, text(body.version, 40), text(body.title, 120), text(body.author, 80),
            text(body.description), JSON.stringify(parseTags(body.tags)), mode, max + 10, now, now,
        );
        touchDraft(db, w.id);
        const p = db.prepare('SELECT * FROM packs WHERE id = ?').get(Number(r.lastInsertRowid));
        return c.json({ pack: packOut(db, p) }, 201);
    });

    app.get('/api/workshops/:id/packs/:packId', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        const p = db.prepare('SELECT * FROM packs WHERE id = ? AND workshop_id = ?').get(Number(c.req.param('packId')), w?.id);
        if (!w || !p) return c.json({ error: { code: 'NOT_FOUND', message: '整合包不存在' } }, 404);
        return c.json({ pack: packOut(db, p) });
    });

    app.patch('/api/workshops/:id/packs/:packId', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        const p = db.prepare('SELECT * FROM packs WHERE id = ? AND workshop_id = ?').get(Number(c.req.param('packId')), w?.id);
        if (!w || !p) return c.json({ error: { code: 'NOT_FOUND', message: '整合包不存在' } }, 404);
        const body = await jsonBody(c);
        if (body.key !== undefined) {
            const key = text(body.key, 64);
            if (!ID_RE.test(key)) return c.json({ error: { code: 'BAD_ID', message: '整合包 id 不合法' } }, 400);
            const dup = db.prepare('SELECT id FROM packs WHERE workshop_id = ? AND key = ? AND id <> ?').get(w.id, key, p.id);
            if (dup) return c.json({ error: { code: 'ID_TAKEN', message: '整合包 id 已存在' } }, 409);
            body.key = key;
        }
        if (body.mode !== undefined && body.mode !== 'refs' && body.mode !== 'file') {
            return c.json({ error: { code: 'BAD_MODE', message: 'mode 只能是 refs 或 file' } }, 400);
        }
        updateRow(db, 'packs', p.id, body, {
            key: 'key', version: 'version', title: 'title', author: 'author',
            description: 'description', tags: 'tags_json', mode: 'mode',
        });
        touchDraft(db, w.id);
        return c.json({ pack: packOut(db, db.prepare('SELECT * FROM packs WHERE id = ?').get(p.id)) });
    });

    app.delete('/api/workshops/:id/packs/:packId', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        const p = db.prepare('SELECT * FROM packs WHERE id = ? AND workshop_id = ?').get(Number(c.req.param('packId')), w?.id);
        if (!w || !p) return c.json({ error: { code: 'NOT_FOUND', message: '整合包不存在' } }, 404);
        db.prepare('DELETE FROM packs WHERE id = ?').run(p.id);
        touchDraft(db, w.id);
        audit(db, 'pack.delete', `${w.slug}/${p.key}`, clientIp(c, config));
        return c.json({ ok: true });
    });

    app.put('/api/workshops/:id/packs/:packId/items', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        const p = db.prepare('SELECT * FROM packs WHERE id = ? AND workshop_id = ?').get(Number(c.req.param('packId')), w?.id);
        if (!w || !p) return c.json({ error: { code: 'NOT_FOUND', message: '整合包不存在' } }, 404);
        const body = await jsonBody(c);
        const raw = Array.isArray(body.items) ? body.items : [];
        if (!raw.length) return c.json({ error: { code: 'EMPTY', message: '至少引用一个模块' } }, 400);
        const modules = db.prepare('SELECT id FROM modules WHERE workshop_id = ?').all(w.id).map(r => r.id);
        const seen = new Set();
        const items = raw.map((it) => {
            const moduleId = Number(it.moduleId);
            if (!modules.includes(moduleId)) throw httpError(400, `模块 ${it.moduleId} 不属于该工坊`);
            if (seen.has(moduleId)) throw httpError(400, '同一个模块不能重复引用');
            seen.add(moduleId);
            return { moduleId, enabled: it.enabled !== false };
        });
        db.exec('BEGIN IMMEDIATE');
        try {
            db.prepare('DELETE FROM pack_items WHERE pack_id = ?').run(p.id);
            const stmt = db.prepare('INSERT INTO pack_items (pack_id, module_id, position, enabled) VALUES (?, ?, ?, ?)');
            items.forEach((it, i) => stmt.run(p.id, it.moduleId, i + 1, it.enabled ? 1 : 0));
            db.prepare("UPDATE packs SET mode = 'refs', updated_at = ? WHERE id = ?").run(nowIso(), p.id);
            db.exec('COMMIT');
        } catch (e) {
            try { db.exec('ROLLBACK'); } catch { /* ignore */ }
            throw e;
        }
        touchDraft(db, w.id);
        return c.json({ pack: packOut(db, db.prepare('SELECT * FROM packs WHERE id = ?').get(p.id)) });
    });

    app.put('/api/workshops/:id/packs/:packId/project', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        const p = db.prepare('SELECT * FROM packs WHERE id = ? AND workshop_id = ?').get(Number(c.req.param('packId')), w?.id);
        if (!w || !p) return c.json({ error: { code: 'NOT_FOUND', message: '整合包不存在' } }, 404);
        const buf = await bodyBuffer(c, MAX_SCRIPT, '.luaproj');
        let parsed;
        try { parsed = parseProjectText(buf.toString('utf8')); }
        catch (e) { return c.json({ error: { code: 'BAD_PROJECT', message: e.message } }, 400); }
        const asset = saveAsset(db, config, { buffer: buf, kind: 'project' });
        db.prepare("UPDATE packs SET mode = 'file', project_asset = ?, updated_at = ? WHERE id = ?")
            .run(asset.sha256, nowIso(), p.id);
        touchDraft(db, w.id);
        return c.json({ sha256: asset.sha256, size: asset.size_bytes, name: parsed.name, modules: parsed.modules.length });
    });

    app.post('/api/workshops/:id/packs/:packId/icon', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        const p = db.prepare('SELECT * FROM packs WHERE id = ? AND workshop_id = ?').get(Number(c.req.param('packId')), w?.id);
        if (!w || !p) return c.json({ error: { code: 'NOT_FOUND', message: '整合包不存在' } }, 404);
        const buf = await bodyBuffer(c, MAX_ICON, '图标');
        const asset = saveAsset(db, config, { buffer: buf, kind: 'icon' });
        db.prepare('UPDATE packs SET icon_asset = ?, updated_at = ? WHERE id = ?').run(asset.sha256, nowIso(), p.id);
        touchDraft(db, w.id);
        return c.json({ sha256: asset.sha256, size: asset.size_bytes, mime: asset.mime });
    });

    app.post('/api/workshops/:id/packs/reorder', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const body = await jsonBody(c);
        const order = Array.isArray(body.order) ? body.order.map(Number) : [];
        const existing = db.prepare('SELECT id FROM packs WHERE workshop_id = ?').all(w.id).map(r => r.id);
        if (order.length !== existing.length || new Set(order).size !== order.length
            || order.some(id => !existing.includes(id))) {
            return c.json({ error: { code: 'BAD_ORDER', message: '排序列表必须包含全部整合包且不重复' } }, 400);
        }
        const stmt = db.prepare('UPDATE packs SET sort_order = ?, updated_at = ? WHERE id = ?');
        order.forEach((id, i) => stmt.run((i + 1) * 10, nowIso(), id));
        touchDraft(db, w.id);
        return c.json({ ok: true });
    });

    // ── 管理端资源预览 ──
    app.get('/api/assets/:sha', (c) => {
        const asset = getAsset(db, c.req.param('sha'));
        if (!asset) return c.json({ error: { code: 'NOT_FOUND', message: '资源不存在' } }, 404);
        const buf = readAsset(config, asset);
        return new Response(buf, {
            status: 200,
            headers: { 'Content-Type': asset.mime, 'Cache-Control': 'private, no-store' },
        });
    });

    // ── 发布 / 历史 / 回滚 ──
    app.post('/api/workshops/:id/publish', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const body = await jsonBody(c);
        const r = publish(db, config, w.id, text(body.note, 200), clientIp(c, config));
        return c.json(r);
    });

    app.get('/api/workshops/:id/releases', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const rows = db.prepare(`SELECT id, revision, fingerprint, note, created_at,
            LENGTH(manifest_json) AS manifest_bytes, LENGTH(items_json) AS items_bytes
            FROM releases WHERE workshop_id = ? ORDER BY revision DESC`).all(w.id);
        return c.json({ releases: rows, current: w.published_revision });
    });

    app.get('/api/workshops/:id/releases/:revision', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const r = db.prepare('SELECT * FROM releases WHERE workshop_id = ? AND revision = ?')
            .get(w.id, Number(c.req.param('revision')));
        if (!r) return c.json({ error: { code: 'NOT_FOUND', message: '修订不存在' } }, 404);
        return c.json({
            revision: r.revision,
            fingerprint: r.fingerprint,
            note: r.note,
            createdAt: r.created_at,
            manifest: JSON.parse(r.manifest_json),
            items: JSON.parse(r.items_json),
            snapshot: JSON.parse(r.snapshot_json),
        });
    });

    app.post('/api/workshops/:id/releases/:revision/rollback', async (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const body = await jsonBody(c);
        const r = rollback(db, config, w.id, Number(c.req.param('revision')), text(body.note, 200), clientIp(c, config));
        return c.json(r);
    });

    // 删除旧发布版本：当前公开版本不允许删（先发布/回滚到别的版本），
    // 其余历史修订可删；release_assets 随 releases 级联删除，资源文件本身不可变、不回收。
    app.delete('/api/workshops/:id/releases/:revision', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const revision = Number(c.req.param('revision'));
        if (revision === w.published_revision) {
            return c.json({ error: { code: 'CURRENT_RELEASE', message: '不能删除当前正在公开的版本；请先发布或回滚到其他版本' } }, 409);
        }
        const r = db.prepare('SELECT id FROM releases WHERE workshop_id = ? AND revision = ?').get(w.id, revision);
        if (!r) return c.json({ error: { code: 'NOT_FOUND', message: '修订不存在' } }, 404);
        db.prepare('DELETE FROM releases WHERE id = ?').run(r.id);
        audit(db, 'release.delete', `${w.slug}@v${revision}`, clientIp(c, config));
        return c.json({ ok: true });
    });

    // ── 导出 ──
    app.get('/api/workshops/:id/export/ws.json', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const level = c.req.query('level') || 'zip';
        const source = c.req.query('source') || 'published';
        const e = buildExport(db, config, w.id, { source, level });
        return new Response(e.wsJson, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${w.slug}-ws.json"` } });
    });

    app.get('/api/workshops/:id/export/items.json', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const level = c.req.query('level') || 'inline';
        const source = c.req.query('source') || 'published';
        const e = buildExport(db, config, w.id, { source, level });
        return new Response(e.itemsJson, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${w.slug}-items.json"` } });
    });

    app.get('/api/workshops/:id/export.zip', (c) => {
        const w = getWorkshop(db, c.req.param('id'));
        if (!w) return c.json({ error: { code: 'NOT_FOUND', message: '工坊不存在' } }, 404);
        const level = c.req.query('level') || 'zip';
        const source = c.req.query('source') || 'published';
        if (!EXPORT_LEVELS.includes(level)) return c.json({ error: { code: 'BAD_LEVEL', message: '未知导出档位' } }, 400);
        const zip = exportZip(db, config, w.id, { source, level });
        return new Response(zip, {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${w.slug}-${level}.zip"`,
            },
        });
    });

    // ── 设置 ──
    app.get('/api/settings', (c) => c.json({
        publicBaseUrl: config.publicBaseUrl,
        username: adminUsername(db),
        siteName: getSetting(db, 'site.name', 'Pico 创意工坊'),
    }));

    app.patch('/api/settings', async (c) => {
        const body = await jsonBody(c);
        if (body.siteName !== undefined) setSetting(db, 'site.name', text(body.siteName, 80));
        return c.json({ ok: true });
    });

    // ── 公开工坊只读 ──
    app.on(['GET', 'HEAD'], '/w/:slug/ws.json', (c) => {
        const w = getWorkshopBySlug(db, c.req.param('slug'));
        if (!w || !w.published_revision) return c.json({ error: { code: 'NOT_FOUND', message: '工坊未发布' } }, 404);
        const r = db.prepare('SELECT manifest_json FROM releases WHERE workshop_id = ? AND revision = ?')
            .get(w.id, w.published_revision);
        if (!r) return c.json({ error: { code: 'NOT_FOUND', message: '发布记录缺失' } }, 404);
        return new Response(r.manifest_json, {
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        });
    });

    app.on(['GET', 'HEAD'], '/w/:slug/items.json', (c) => {
        const w = getWorkshopBySlug(db, c.req.param('slug'));
        if (!w || !w.published_revision) return c.json({ error: { code: 'NOT_FOUND', message: '工坊未发布' } }, 404);
        if (!w.serve_items) return c.json({ error: { code: 'DISABLED', message: 'items.json 未公开' } }, 404);
        const r = db.prepare('SELECT items_json FROM releases WHERE workshop_id = ? AND revision = ?')
            .get(w.id, w.published_revision);
        if (!r) return c.json({ error: { code: 'NOT_FOUND', message: '发布记录缺失' } }, 404);
        return new Response(r.items_json, {
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        });
    });

    app.on(['GET', 'HEAD'], '/w/:slug/assets/:file', (c) => {
        const w = getWorkshopBySlug(db, c.req.param('slug'));
        const parsed = parseAssetFile(c.req.param('file'));
        if (!w || !w.published_revision || !parsed) return c.json({ error: { code: 'NOT_FOUND', message: '资源不存在' } }, 404);
        if (!w.serve_assets) return c.json({ error: { code: 'DISABLED', message: 'assets 未公开' } }, 404);
        const asset = getAsset(db, parsed.sha);
        if (!asset || asset.ext !== parsed.ext) return c.json({ error: { code: 'NOT_FOUND', message: '资源不存在' } }, 404);
        const used = db.prepare(`SELECT 1 FROM release_assets ra JOIN releases r ON r.id = ra.release_id
            WHERE r.workshop_id = ? AND ra.asset_sha = ? LIMIT 1`).get(w.id, asset.sha256);
        if (!used) return c.json({ error: { code: 'NOT_FOUND', message: '资源未被该工坊发布引用' } }, 404);
        const buf = readAsset(config, asset);
        return new Response(buf, {
            headers: {
                'Content-Type': asset.mime,
                'Cache-Control': 'public, max-age=31536000, immutable',
                'ETag': `"${asset.sha256}"`,
            },
        });
    });

    app.all('/w/*', (c) => c.json({ error: { code: 'NOT_FOUND', message: '不存在' } }, 404));

    // ── 健康检查 ──
    app.get('/healthz', (c) => {
        const schema = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
        return c.json({ ok: true, version: APP_VERSION, schemaVersion: schema?.v ?? 0, uptime: process.uptime() });
    });

    // ── 管理 API 兜底 ──
    app.all('/api/*', (c) => c.json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404));

    // ── SPA 静态 ──
    app.use('/assets/*', serveStatic({ root: './web/dist' }));
    app.get('*', serveStatic({ root: './web/dist', rewriteRequestPath: (p) => (p === '/' || !p.includes('.') ? '/index.html' : p) }));

    app.onError((err, c) => {
        const status = Number(err.status) || 500;
        if (status >= 500) console.error('[error]', err);
        if (c.req.path.startsWith('/w/')) {
            c.header('Access-Control-Allow-Origin', '*');
            c.header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
        }
        return c.json({
            error: {
                code: err.code || (status === 500 ? 'INTERNAL' : 'ERROR'),
                message: status === 500 ? '服务器内部错误' : err.message,
                details: err.details,
            },
        }, status);
    });

    return app;
}
