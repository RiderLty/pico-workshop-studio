CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workshops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    items_mode TEXT NOT NULL DEFAULT 'server' CHECK (items_mode IN ('server', 'external')),
    external_items_url TEXT NOT NULL DEFAULT '',
    serve_items INTEGER NOT NULL DEFAULT 1,
    serve_assets INTEGER NOT NULL DEFAULT 1,
    published_revision INTEGER NOT NULL DEFAULT 0,
    published_fingerprint TEXT NOT NULL DEFAULT '',
    draft_fingerprint TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS assets (
    sha256 TEXT PRIMARY KEY,
    size_bytes INTEGER NOT NULL,
    mime TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('script', 'project', 'icon')),
    ext TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    icon_asset TEXT REFERENCES assets(sha256),
    content_asset TEXT REFERENCES assets(sha256),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (workshop_id, key)
);

CREATE TABLE IF NOT EXISTS packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    icon_asset TEXT REFERENCES assets(sha256),
    mode TEXT NOT NULL DEFAULT 'refs' CHECK (mode IN ('refs', 'file')),
    project_asset TEXT REFERENCES assets(sha256),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (workshop_id, key)
);

CREATE TABLE IF NOT EXISTS pack_items (
    pack_id INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
    module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (pack_id, module_id),
    UNIQUE (pack_id, position)
);

CREATE TABLE IF NOT EXISTS releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    items_json TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (workshop_id, revision)
);

CREATE TABLE IF NOT EXISTS release_assets (
    release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    asset_sha TEXT NOT NULL REFERENCES assets(sha256) ON DELETE RESTRICT,
    path TEXT NOT NULL,
    PRIMARY KEY (release_id, path)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    detail_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_modules_workshop ON modules(workshop_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_packs_workshop ON packs(workshop_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_pack_items_module ON pack_items(module_id);
CREATE INDEX IF NOT EXISTS idx_releases_workshop ON releases(workshop_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_release_assets_sha ON release_assets(asset_sha);
