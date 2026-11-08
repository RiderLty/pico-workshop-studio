// 管理 API 客户端：同源 Cookie、CSRF Header、401 统一登出。
let csrfToken = '';

export function setCsrfToken(t) {
    csrfToken = t || '';
}

async function request(method, path, body, opts = {}) {
    const headers = {};
    if (opts.raw) {
        if (opts.contentType) headers['content-type'] = opts.contentType;
    } else if (body !== undefined) {
        headers['content-type'] = 'application/json';
    }
    if (method !== 'GET' && method !== 'HEAD') headers['x-csrf-token'] = csrfToken;

    const res = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        body: opts.raw ? body : (body === undefined ? undefined : JSON.stringify(body)),
    });
    if (res.status === 401) window.dispatchEvent(new Event('pws-unauthorized'));
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
    if (!res.ok) {
        const err = new Error(json?.error?.message || text || `HTTP ${res.status}`);
        err.status = res.status;
        err.data = json;
        throw err;
    }
    return json ?? text;
}

export const api = {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    patch: (p, b) => request('PATCH', p, b),
    put: (p, b) => request('PUT', p, b),
    del: (p, b) => request('DELETE', p, b),
    raw: (method, p, body, contentType) => request(method, p, body, { raw: true, contentType }),

    async download(path, filename) {
        const res = await fetch(path, { headers: { 'x-csrf-token': csrfToken }, credentials: 'same-origin' });
        if (!res.ok) {
            const text = await res.text();
            let msg = text;
            try { msg = JSON.parse(text)?.error?.message || text; } catch { /* ignore */ }
            throw new Error(msg || `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'download';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
};
