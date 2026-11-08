// ---------------------------------------------------------------------------
// 内容寻址资源库：data/assets/<sha[0:2]>/<sha[2:4]>/<sha>.<ext>
// 不可变、按 SHA-256 去重；脚本/图标/项目文件都走这里。
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { nowIso } from './db.js';

const utf8 = new TextDecoder('utf-8', { fatal: true });

export function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

export function assetDiskPath(config, asset) {
    return path.join(config.assetsDir, asset.sha256.slice(0, 2), asset.sha256.slice(2, 4), `${asset.sha256}.${asset.ext}`);
}

export function publicAssetPath(asset) {
    return `assets/${asset.sha256}.${asset.ext}`;
}

export function base64(buf) {
    return Buffer.from(buf).toString('base64');
}

export function dataUrl(asset, buf) {
    return `data:${asset.mime};base64,${base64(buf)}`;
}

/** PNG / JPEG / GIF / WebP 魔数；v1 不接受 SVG（管理端 XSS 面更小）。 */
export function detectImage(buf) {
    if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return { mime: 'image/png', ext: 'png' };
    }
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        return { mime: 'image/jpeg', ext: 'jpg' };
    }
    if (buf.length >= 6) {
        const head = buf.subarray(0, 6).toString('latin1');
        if (head === 'GIF87a' || head === 'GIF89a') return { mime: 'image/gif', ext: 'gif' };
    }
    if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF'
        && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
        return { mime: 'image/webp', ext: 'webp' };
    }
    return null;
}

function assertUtf8(buf, label) {
    try { utf8.decode(buf); }
    catch { throw Object.assign(new Error(`${label} 不是合法 UTF-8`), { status: 400 }); }
}

/**
 * 保存资源。kind: script | project | icon。
 * 图标只接受 PNG/JPEG/GIF/WebP，以魔数为准；脚本/项目文件必须是合法 UTF-8。
 */
export function saveAsset(db, config, { buffer, kind }) {
    const buf = Buffer.from(buffer);
    if (!buf.length) throw Object.assign(new Error('内容为空'), { status: 400 });

    let mime;
    let ext;
    if (kind === 'icon') {
        const img = detectImage(buf);
        if (!img) throw Object.assign(new Error('图标只支持 PNG / JPEG / GIF / WebP'), { status: 400 });
        mime = img.mime;
        ext = img.ext;
    } else if (kind === 'script') {
        assertUtf8(buf, '脚本');
        mime = 'text/plain; charset=utf-8';
        ext = 'lua';
    } else if (kind === 'project') {
        assertUtf8(buf, '项目文件');
        mime = 'application/json; charset=utf-8';
        ext = 'luaproj';
    } else {
        throw Object.assign(new Error('未知资源类型'), { status: 400 });
    }

    const sha = sha256(buf);
    const asset = { sha256: sha, size_bytes: buf.length, mime, kind, ext };
    const p = assetDiskPath(config, asset);
    if (!fs.existsSync(p)) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, p);
    }
    const existing = db.prepare('SELECT sha256 FROM assets WHERE sha256 = ?').get(sha);
    if (!existing) {
        db.prepare('INSERT INTO assets (sha256, size_bytes, mime, kind, ext, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(sha, buf.length, mime, kind, ext, nowIso());
    }
    return asset;
}

export function getAsset(db, sha) {
    return db.prepare('SELECT * FROM assets WHERE sha256 = ?').get(sha) || null;
}

export function readAsset(config, asset) {
    return fs.readFileSync(assetDiskPath(config, asset));
}
