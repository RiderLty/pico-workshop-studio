// ---------------------------------------------------------------------------
// 端到端 API 回归（node:test）：登录 → 工坊/模块/整合包 → 发布 → 公开读取 → 导出。
// 运行：npm test
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { openDb, migrate } from '../db.js';
import { createApp } from '../app.js';

const ORIGIN = 'http://localhost:8099';
const PASSWORD = 'test-password-123';

function makeApp() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pws-test-'));
    const config = loadConfig({
        DATA_DIR: dir,
        PUBLIC_BASE_URL: ORIGIN,
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: PASSWORD,
        SESSION_SECRET: 'test-secret-test-secret-test-secret',
        NODE_ENV: 'test',
    });
    const db = openDb(config.dbPath);
    migrate(db);
    const app = createApp({ db, config });
    return { app, db, config, dir };
}

async function login(app) {
    const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.startsWith('pws_session='));
    return { cookie, csrf: body.csrfToken };
}

function headers(auth, extra = {}) {
    return { origin: ORIGIN, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...extra };
}

async function json(app, method, url, auth, body) {
    const res = await app.request(url, {
        method,
        headers: headers(auth, { 'content-type': 'application/json' }),
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    assert.ok(res.ok, `${method} ${url} -> ${res.status} ${text}`);
    return JSON.parse(text);
}

test('完整发布链路', async (t) => {
    const { app, db, dir } = makeApp();
    t.after(() => { try { db.close(); } catch { /* ignore */ } fs.rmSync(dir, { recursive: true, force: true }); });

    const auth = await login(app);
    const ws = (await json(app, 'POST', '/api/workshops', auth, { slug: 'demo', name: '演示工坊' })).workshop;
    assert.equal(ws.slug, 'demo');

    const mod = (await json(app, 'POST', `/api/workshops/${ws.id}/modules`, auth, {
        key: 'hello', title: '示例模块', version: '1.0.0', author: 'tester',
        description: '中文说明', tags: ['演示'],
    })).module;
    const code = 'function on_init()\n    print("你好")\nend\n';
    const up = await app.request(`/api/workshops/${ws.id}/modules/${mod.id}/content`, {
        method: 'PUT',
        headers: headers(auth, { 'content-type': 'text/plain; charset=utf-8' }),
        body: code,
    });
    assert.equal(up.status, 200);

    const pack = (await json(app, 'POST', `/api/workshops/${ws.id}/packs`, auth, {
        key: 'starter', title: '入门包', version: '1.0.0',
    })).pack;
    await json(app, 'PUT', `/api/workshops/${ws.id}/packs/${pack.id}/items`, auth, {
        items: [{ moduleId: mod.id, enabled: true }],
    });

    const pub = await json(app, 'POST', `/api/workshops/${ws.id}/publish`, auth, { note: 'first' });
    assert.equal(pub.noChanges, false);
    assert.equal(pub.revision, 1);

    // 公开 ws.json / items.json（无 Cookie）+ CORS
    const wsRes = await app.request('/w/demo/ws.json');
    assert.equal(wsRes.status, 200);
    assert.equal(wsRes.headers.get('access-control-allow-origin'), '*');
    const manifest = JSON.parse(await wsRes.text());
    assert.equal(manifest.format, 'pico-workshop');
    assert.equal(manifest.version, 1);
    assert.equal(manifest.url, 'items.json');

    const itemsRes = await app.request('/w/demo/items.json');
    assert.equal(itemsRes.status, 200);
    assert.equal(itemsRes.headers.get('access-control-allow-origin'), '*');
    const items = JSON.parse(await itemsRes.text());
    assert.equal(items.modules.length, 1);
    assert.equal(items.modules[0].id, 'hello');
    assert.equal(items.modules[0].size, Buffer.byteLength(code));
    assert.equal(items.packs[0].items[0], 'hello');

    // 资源字节数 == size
    const assetRes = await app.request('/w/demo/' + items.modules[0].url);
    assert.equal(assetRes.status, 200);
    const assetBuf = Buffer.from(await assetRes.arrayBuffer());
    assert.equal(assetBuf.length, Buffer.byteLength(code));
    assert.equal(assetBuf.toString('utf8'), code);

    // 无变化发布不递增
    const again = await json(app, 'POST', `/api/workshops/${ws.id}/publish`, auth, {});
    assert.equal(again.noChanges, true);
    assert.equal(again.revision, 1);

    // 全内联导出
    const inline = await json(app, 'GET', `/api/workshops/${ws.id}/export/items.json?level=inline&source=published`, auth);
    assert.ok(inline.modules[0].inlineBase64);
    assert.equal(inline.modules[0].size, Buffer.byteLength(code));

    // 内容变化 → v2；回滚 → v3
    await app.request(`/api/workshops/${ws.id}/modules/${mod.id}/content`, {
        method: 'PUT',
        headers: headers(auth, { 'content-type': 'text/plain; charset=utf-8' }),
        body: code + '-- v2\n',
    });
    const v2 = await json(app, 'POST', `/api/workshops/${ws.id}/publish`, auth, { note: 'v2' });
    assert.equal(v2.revision, 2);
    const rb = await json(app, 'POST', `/api/workshops/${ws.id}/releases/1/rollback`, auth, {});
    assert.equal(rb.revision, 3);
    const after = JSON.parse(await (await app.request('/w/demo/items.json')).text());
    assert.equal(after.modules[0].size, Buffer.byteLength(code));

    // 托管可见性开关
    await json(app, 'PATCH', `/api/workshops/${ws.id}/visibility`, auth, { serveItems: false, serveAssets: false });
    assert.equal((await app.request('/w/demo/items.json')).status, 404);
    assert.equal((await app.request('/w/demo/' + items.modules[0].url)).status, 404);
    assert.equal((await app.request('/w/demo/ws.json')).status, 200);
});

test('认证与 CSRF', async (t) => {
    const { app, db, dir } = makeApp();
    t.after(() => { try { db.close(); } catch { /* ignore */ } fs.rmSync(dir, { recursive: true, force: true }); });

    const auth = await login(app);
    const noCsrf = await app.request('/api/workshops', {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: auth.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 'x', name: 'X' }),
    });
    assert.equal(noCsrf.status, 403);

    const badOrigin = await app.request('/api/workshops', {
        method: 'POST',
        headers: { origin: 'http://evil.example', cookie: auth.cookie, 'x-csrf-token': auth.csrf, 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 'x', name: 'X' }),
    });
    assert.equal(badOrigin.status, 403);

    assert.equal((await app.request('/api/workshops')).status, 401);
});
