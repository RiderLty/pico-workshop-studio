import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    AppBar, Toolbar, Typography, Box, Button, IconButton, Tabs, Tab, Card, CardContent,
    Table, TableHead, TableRow, TableCell, TableBody, Chip, Dialog, DialogTitle,
    DialogContent, DialogActions, TextField, Stack, Alert, Switch, FormControlLabel,
    RadioGroup, Radio, FormControl, FormLabel, Select, MenuItem, InputLabel, Tooltip,
    Divider, CircularProgress, List, ListItem, ListItemText, Checkbox,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PublishIcon from '@mui/icons-material/Publish';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import LogoutIcon from '@mui/icons-material/Logout';
import { api } from '../api.js';
import CodeEditor from '../editor/CodeEditor.jsx';

async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { /* ignore */ }
        ta.remove();
        return ok;
    }
}

const fmtBytes = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

function ConfirmDialog({ open, title, text, confirmLabel = '确认', danger, onClose, onConfirm, busy }) {
    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle>{title}</DialogTitle>
            <DialogContent><Typography variant="body2">{text}</Typography></DialogContent>
            <DialogActions>
                <Button onClick={onClose}>取消</Button>
                <Button variant="contained" color={danger ? 'error' : 'primary'} disableElevation
                    disabled={busy} onClick={onConfirm}>{busy ? '处理中…' : confirmLabel}</Button>
            </DialogActions>
        </Dialog>
    );
}

function CopyButton({ text, notify }) {
    return (
        <Tooltip title="复制公开源地址">
            <IconButton size="small" onClick={async () => {
                if (await copyText(text)) notify('已复制源地址');
                else notify('复制失败', 'error');
            }}><ContentCopyIcon fontSize="small" /></IconButton>
        </Tooltip>
    );
}

// ── 模块编辑 ──────────────────────────────────────────────────────────────

function ModuleDialog({ open, workshopId, initial, onClose, onSaved, notify }) {
    const [form, setForm] = useState({ key: '', title: '', version: '1.0.0', author: '', description: '', tags: '' });
    const [code, setCode] = useState('');
    const [iconFile, setIconFile] = useState(null);
    const [iconUrl, setIconUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setErr(null);
        setIconFile(null);
        if (initial) {
            setForm({
                key: initial.key, title: initial.title, version: initial.version,
                author: initial.author || '', description: initial.description || '',
                tags: (initial.tags || []).join(', '),
            });
            setIconUrl(initial.iconUrl || '');
            setLoading(true);
            api.get(`/api/workshops/${workshopId}/modules/${initial.id}`)
                .then(r => setCode(r.code || ''))
                .catch(e => setErr(e.message))
                .finally(() => setLoading(false));
        } else {
            setForm({ key: '', title: '', version: '1.0.0', author: '', description: '', tags: '' });
            setCode('');
            setIconUrl('');
        }
    }, [open, initial, workshopId]);

    const save = async () => {
        setSaving(true);
        setErr(null);
        try {
            const payload = {
                key: form.key.trim(), title: form.title.trim(), version: form.version.trim(),
                author: form.author.trim(), description: form.description.trim(),
                tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
            };
            let moduleId = initial?.id;
            if (initial) await api.patch(`/api/workshops/${workshopId}/modules/${moduleId}`, payload);
            else moduleId = (await api.post(`/api/workshops/${workshopId}/modules`, payload)).module.id;
            if (code.trim()) {
                await api.raw('PUT', `/api/workshops/${workshopId}/modules/${moduleId}/content`, code, 'text/plain; charset=utf-8');
            }
            if (iconFile) {
                await api.raw('POST', `/api/workshops/${workshopId}/modules/${moduleId}/icon`, iconFile, iconFile.type);
            }
            onSaved();
            onClose();
            notify(initial ? '模块已保存' : '模块已创建');
        } catch (e) {
            setErr(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="lg">
            <DialogTitle>{initial ? `编辑模块 · ${initial.key}` : '新建模块'}</DialogTitle>
            <DialogContent dividers>
                {loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress /></Box> : (
                    <Stack spacing={2}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
                            <TextField size="small" label="id（key）" value={form.key}
                                helperText="源内唯一；字母/数字/._-"
                                onChange={e => setForm({ ...form, key: e.target.value })} />
                            <TextField size="small" label="标题" value={form.title}
                                onChange={e => setForm({ ...form, title: e.target.value })} />
                            <TextField size="small" label="版本" value={form.version}
                                onChange={e => setForm({ ...form, version: e.target.value })} />
                        </Box>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                            <TextField size="small" label="作者" value={form.author}
                                onChange={e => setForm({ ...form, author: e.target.value })} />
                            <TextField size="small" label="标签（逗号分隔）" value={form.tags}
                                onChange={e => setForm({ ...form, tags: e.target.value })} />
                        </Box>
                        <TextField size="small" label="说明" multiline minRows={2} value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })} />
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Button variant="outlined" component="label" size="small">
                                选择图标
                                <input hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif"
                                    onChange={e => setIconFile(e.target.files?.[0] || null)} />
                            </Button>
                            {iconFile && <Typography variant="caption">{iconFile.name}</Typography>}
                            {!iconFile && iconUrl && <img src={iconUrl} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />}
                            <Typography variant="caption" color="text.secondary">PNG / JPEG / WebP / GIF，≤256KB</Typography>
                        </Box>
                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>脚本内容</Typography>
                            <CodeEditor value={code} onChange={setCode} height={360} />
                            <Typography variant="caption" color="text.secondary">
                                {new TextEncoder().encode(code).length} 字节 · 当前固件单模块上限 64KB
                            </Typography>
                        </Box>
                        {err && <Alert severity="error">{err}</Alert>}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={saving}>取消</Button>
                <Button variant="contained" disableElevation startIcon={<SaveIcon />}
                    disabled={saving || !form.key || !form.title || !form.version} onClick={save}>
                    {saving ? '保存中…' : '保存'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ── 整合包编辑 ────────────────────────────────────────────────────────────

function PackDialog({ open, workshopId, initial, modules, onClose, onSaved, notify }) {
    const [form, setForm] = useState({ key: '', title: '', version: '1.0.0', author: '', description: '', tags: '' });
    const [mode, setMode] = useState('refs');
    const [selected, setSelected] = useState([]);   // [{ moduleId, enabled }]
    const [file, setFile] = useState(null);
    const [hasProject, setHasProject] = useState(false);
    const [err, setErr] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setErr(null);
        setFile(null);
        if (initial) {
            setForm({
                key: initial.key, title: initial.title, version: initial.version,
                author: initial.author || '', description: initial.description || '',
                tags: (initial.tags || []).join(', '),
            });
            setMode(initial.mode);
            setSelected((initial.items || []).map(it => ({ moduleId: it.moduleId, enabled: it.enabled })));
            setHasProject(!!initial.projectAsset);
        } else {
            setForm({ key: '', title: '', version: '1.0.0', author: '', description: '', tags: '' });
            setMode('refs');
            setSelected([]);
            setHasProject(false);
        }
    }, [open, initial]);

    const toggleModule = (moduleId) => {
        setSelected(prev => prev.some(x => x.moduleId === moduleId)
            ? prev.filter(x => x.moduleId !== moduleId)
            : [...prev, { moduleId, enabled: true }]);
    };
    const move = (index, delta) => {
        const next = [...selected];
        const j = index + delta;
        if (j < 0 || j >= next.length) return;
        [next[index], next[j]] = [next[j], next[index]];
        setSelected(next);
    };

    const save = async () => {
        setSaving(true);
        setErr(null);
        try {
            const payload = {
                key: form.key.trim(), title: form.title.trim(), version: form.version.trim(),
                author: form.author.trim(), description: form.description.trim(),
                tags: form.tags.split(',').map(s => s.trim()).filter(Boolean), mode,
            };
            let packId = initial?.id;
            if (initial) await api.patch(`/api/workshops/${workshopId}/packs/${packId}`, payload);
            else packId = (await api.post(`/api/workshops/${workshopId}/packs`, payload)).pack.id;

            if (mode === 'refs') {
                if (!selected.length) throw new Error('至少选择一个模块');
                await api.put(`/api/workshops/${workshopId}/packs/${packId}/items`, { items: selected });
            } else {
                if (file) {
                    const text = await file.text();
                    await api.raw('PUT', `/api/workshops/${workshopId}/packs/${packId}/project`, text, 'application/json');
                } else if (!hasProject) {
                    throw new Error('请上传 .luaproj 文件');
                }
            }
            onSaved();
            onClose();
            notify(initial ? '整合包已保存' : '整合包已创建');
        } catch (e) {
            setErr(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="lg">
            <DialogTitle>{initial ? `编辑整合包 · ${initial.key}` : '新建整合包'}</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
                        <TextField size="small" label="id（key）" value={form.key}
                            onChange={e => setForm({ ...form, key: e.target.value })} />
                        <TextField size="small" label="标题" value={form.title}
                            onChange={e => setForm({ ...form, title: e.target.value })} />
                        <TextField size="small" label="版本" value={form.version}
                            onChange={e => setForm({ ...form, version: e.target.value })} />
                    </Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                        <TextField size="small" label="作者" value={form.author}
                            onChange={e => setForm({ ...form, author: e.target.value })} />
                        <TextField size="small" label="标签（逗号分隔）" value={form.tags}
                            onChange={e => setForm({ ...form, tags: e.target.value })} />
                    </Box>
                    <TextField size="small" label="说明" multiline minRows={2} value={form.description}
                        onChange={e => setForm({ ...form, description: e.target.value })} />

                    <FormControl>
                        <FormLabel>内容方式</FormLabel>
                        <RadioGroup row value={mode} onChange={e => setMode(e.target.value)}>
                            <FormControlLabel value="refs" control={<Radio size="small" />} label="引用模块（有序）" />
                            <FormControlLabel value="file" control={<Radio size="small" />} label="上传 .luaproj" />
                        </RadioGroup>
                    </FormControl>

                    {mode === 'refs' ? (
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                            <Card elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                                <CardContent>
                                    <Typography variant="subtitle2" sx={{ mb: 1 }}>可选模块</Typography>
                                    <List dense>
                                        {modules.map(m => (
                                            <ListItem key={m.id} disablePadding>
                                                <Checkbox size="small" checked={selected.some(x => x.moduleId === m.id)}
                                                    onChange={() => toggleModule(m.id)} />
                                                <ListItemText primary={m.title} secondary={`${m.key} · ${m.version}`} />
                                            </ListItem>
                                        ))}
                                        {!modules.length && <Typography variant="body2" color="text.secondary">还没有模块</Typography>}
                                    </List>
                                </CardContent>
                            </Card>
                            <Card elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                                <CardContent>
                                    <Typography variant="subtitle2" sx={{ mb: 1 }}>执行顺序</Typography>
                                    <List dense>
                                        {selected.map((it, i) => {
                                            const m = modules.find(x => x.id === it.moduleId);
                                            return (
                                                <ListItem key={it.moduleId} disablePadding
                                                    secondaryAction={
                                                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                                            <FormControlLabel sx={{ mr: 0 }}
                                                                control={<Switch size="small" checked={it.enabled}
                                                                    onChange={e => setSelected(selected.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))} />}
                                                                label={<Typography variant="caption">启用</Typography>} />
                                                            <IconButton size="small" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUpwardIcon fontSize="small" /></IconButton>
                                                            <IconButton size="small" onClick={() => move(i, 1)} disabled={i === selected.length - 1}><ArrowDownwardIcon fontSize="small" /></IconButton>
                                                        </Box>
                                                    }>
                                                    <ListItemText primary={`${i + 1}. ${m?.title || it.moduleId}`} secondary={m?.key} />
                                                </ListItem>
                                            );
                                        })}
                                        {!selected.length && <Typography variant="body2" color="text.secondary">勾选左侧模块</Typography>}
                                    </List>
                                </CardContent>
                            </Card>
                        </Box>
                    ) : (
                        <Box>
                            <Button variant="outlined" component="label" size="small">
                                选择 .luaproj
                                <input hidden type="file" accept=".luaproj,application/json"
                                    onChange={e => setFile(e.target.files?.[0] || null)} />
                            </Button>
                            {file && <Typography variant="caption" sx={{ ml: 1 }}>{file.name}</Typography>}
                            {!file && hasProject && <Typography variant="caption" sx={{ ml: 1 }}>已上传过 .luaproj</Typography>}
                        </Box>
                    )}
                    {err && <Alert severity="error">{err}</Alert>}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={saving}>取消</Button>
                <Button variant="contained" disableElevation startIcon={<SaveIcon />}
                    disabled={saving || !form.key || !form.title || !form.version} onClick={save}>
                    {saving ? '保存中…' : '保存'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ── 发布 ──────────────────────────────────────────────────────────────────

function PublishDialog({ open, workshopId, onClose, onPublished, notify }) {
    const [result, setResult] = useState(null);
    const [note, setNote] = useState('');
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!open) return;
        setResult(null);
        setErr(null);
        setNote('');
        api.get(`/api/workshops/${workshopId}/validation`)
            .then(setResult)
            .catch(e => setErr(e.message));
    }, [open, workshopId]);

    const publishNow = async () => {
        setBusy(true);
        setErr(null);
        try {
            const r = await api.post(`/api/workshops/${workshopId}/publish`, { note });
            notify(r.noChanges ? '内容没有变化，未递增版本' : `已发布 v${r.revision}`);
            onPublished();
            onClose();
        } catch (e) {
            setErr(e.message);
            if (e.data?.details) setResult({ errors: e.data.details.errors || [], warnings: e.data.details.warnings || [] });
        } finally {
            setBusy(false);
        }
    };

    const errors = result?.errors || [];
    const warnings = result?.warnings || [];
    return (
        <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
            <DialogTitle>发布工坊</DialogTitle>
            <DialogContent dividers>
                {!result && !err ? <CircularProgress size={24} /> : (
                    <Stack spacing={2}>
                        {errors.length > 0 && (
                            <Alert severity="error">
                                <Typography variant="subtitle2">需要先修复：</Typography>
                                {errors.map((e, i) => <div key={i}>· {e}</div>)}
                            </Alert>
                        )}
                        {warnings.length > 0 && (
                            <Alert severity="warning">
                                {warnings.map((w, i) => <div key={i}>· {w}</div>)}
                            </Alert>
                        )}
                        {!errors.length && <Alert severity="success">校验通过，可以发布。</Alert>}
                        <TextField size="small" label="发布说明（可选）" value={note}
                            onChange={e => setNote(e.target.value)} />
                        {err && <Alert severity="error">{err}</Alert>}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>取消</Button>
                <Button variant="contained" disableElevation startIcon={<PublishIcon />}
                    disabled={busy || !result || errors.length > 0} onClick={publishNow}>
                    {busy ? '发布中…' : '确认发布'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ── 各分页 ────────────────────────────────────────────────────────────────

function OverviewTab({ workshop, onSaved, notify, navigate }) {
    const [name, setName] = useState(workshop.name);
    const [description, setDescription] = useState(workshop.description || '');
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const save = async () => {
        setSaving(true);
        try {
            await api.patch(`/api/workshops/${workshop.id}`, { name, description, baseUpdatedAt: workshop.updatedAt });
            onSaved();
            notify('已保存');
        } catch (e) {
            notify(e.message, 'error');
        } finally { setSaving(false); }
    };
    const remove = async () => {
        try {
            await api.del(`/api/workshops/${workshop.id}`, { confirmSlug: workshop.slug });
            notify('工坊已删除');
            navigate('/');
        } catch (e) {
            notify(e.message, 'error');
        } finally { setConfirmDelete(false); }
    };

    return (
        <Stack spacing={2}>
            <Card elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                <CardContent>
                    <Stack spacing={2}>
                        <TextField size="small" label="名称" value={name} onChange={e => setName(e.target.value)} />
                        <TextField size="small" label="说明" multiline minRows={2} value={description}
                            onChange={e => setDescription(e.target.value)} />
                        <Box>
                            <Button variant="contained" disableElevation startIcon={<SaveIcon />}
                                disabled={saving} onClick={save}>{saving ? '保存中…' : '保存基本信息'}</Button>
                        </Box>
                    </Stack>
                </CardContent>
            </Card>
            <Card elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                <CardContent>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>公开信息</Typography>
                    <Stack spacing={1}>
                        <Typography variant="body2">slug：<code>{workshop.slug}</code></Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                                源地址：<code>{workshop.sourceUrl}</code>
                            </Typography>
                            <CopyButton text={workshop.sourceUrl} notify={notify} />
                        </Box>
                        <Typography variant="body2">当前发布：{workshop.publishedRevision ? `v${workshop.publishedRevision}` : '未发布'}</Typography>
                        <Typography variant="body2">模块 {workshop.moduleCount} · 整合包 {workshop.packCount}</Typography>
                    </Stack>
                </CardContent>
            </Card>
            <Card elevation={0} sx={{ border: '1px solid #fecaca' }}>
                <CardContent>
                    <Typography variant="subtitle2" color="error" sx={{ mb: 1 }}>危险操作</Typography>
                    <Button color="error" variant="outlined" onClick={() => setConfirmDelete(true)}>删除工坊</Button>
                    <ConfirmDialog open={confirmDelete} danger title="删除工坊"
                        text={`将软删除「${workshop.name}」，公开地址立即 404，历史与资源保留。`}
                        confirmLabel="删除" onClose={() => setConfirmDelete(false)} onConfirm={remove} />
                </CardContent>
            </Card>
        </Stack>
    );
}

function ModulesTab({ workshopId, modules, onRefresh, notify }) {
    const [editing, setEditing] = useState(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [deleting, setDeleting] = useState(null);
    const [busy, setBusy] = useState(false);

    const openNew = () => { setEditing(null); setDialogOpen(true); };
    const openEdit = (m) => { setEditing(m); setDialogOpen(true); };
    const remove = async () => {
        setBusy(true);
        try {
            await api.del(`/api/workshops/${workshopId}/modules/${deleting.id}`);
            notify('模块已删除');
            onRefresh();
        } catch (e) {
            notify(e.message, 'error');
        } finally { setBusy(false); setDeleting(null); }
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', mb: 2 }}>
                <Typography variant="h6" sx={{ flex: 1 }}>模块</Typography>
                <Button variant="contained" disableElevation startIcon={<AddIcon />} onClick={openNew}>新建模块</Button>
            </Box>
            <Card elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>标题</TableCell><TableCell>id</TableCell><TableCell>版本</TableCell>
                            <TableCell>大小</TableCell><TableCell>被引用</TableCell><TableCell align="right">操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {modules.map(m => (
                            <TableRow key={m.id} hover>
                                <TableCell>{m.title}</TableCell>
                                <TableCell><code>{m.key}</code></TableCell>
                                <TableCell>{m.version}</TableCell>
                                <TableCell>{m.contentSize ? fmtBytes(m.contentSize) : '—'}</TableCell>
                                <TableCell>{m.referencedBy.length ? m.referencedBy.join(', ') : '—'}</TableCell>
                                <TableCell align="right">
                                    <IconButton size="small" onClick={() => openEdit(m)}><EditIcon fontSize="small" /></IconButton>
                                    <IconButton size="small" onClick={() => setDeleting(m)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                        {!modules.length && (
                            <TableRow><TableCell colSpan={6} align="center"><Typography variant="body2" color="text.secondary">还没有模块</Typography></TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </Card>
            <ModuleDialog open={dialogOpen} workshopId={workshopId} initial={editing}
                onClose={() => setDialogOpen(false)} onSaved={onRefresh} notify={notify} />
            <ConfirmDialog open={!!deleting} danger title="删除模块"
                text={deleting ? `确定删除「${deleting.title}」？${deleting.referencedBy.length ? `它被整合包 ${deleting.referencedBy.join(', ')} 引用，需要先移除引用。` : ''}` : ''}
                confirmLabel="删除" busy={busy} onClose={() => setDeleting(null)} onConfirm={remove} />
        </Box>
    );
}

function PacksTab({ workshopId, packs, modules, onRefresh, notify }) {
    const [editing, setEditing] = useState(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [deleting, setDeleting] = useState(null);
    const [busy, setBusy] = useState(false);

    const remove = async () => {
        setBusy(true);
        try {
            await api.del(`/api/workshops/${workshopId}/packs/${deleting.id}`);
            notify('整合包已删除');
            onRefresh();
        } catch (e) {
            notify(e.message, 'error');
        } finally { setBusy(false); setDeleting(null); }
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', mb: 2 }}>
                <Typography variant="h6" sx={{ flex: 1 }}>整合包</Typography>
                <Button variant="contained" disableElevation startIcon={<AddIcon />}
                    onClick={() => { setEditing(null); setDialogOpen(true); }}>新建整合包</Button>
            </Box>
            <Card elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>标题</TableCell><TableCell>id</TableCell><TableCell>版本</TableCell>
                            <TableCell>方式</TableCell><TableCell>条目</TableCell><TableCell align="right">操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {packs.map(p => (
                            <TableRow key={p.id} hover>
                                <TableCell>{p.title}</TableCell>
                                <TableCell><code>{p.key}</code></TableCell>
                                <TableCell>{p.version}</TableCell>
                                <TableCell>{p.mode === 'refs' ? '引用' : '.luaproj'}</TableCell>
                                <TableCell>{p.mode === 'refs' ? `${p.items.length} 项` : fmtBytes(p.projectSize)}</TableCell>
                                <TableCell align="right">
                                    <IconButton size="small" onClick={() => { setEditing(p); setDialogOpen(true); }}><EditIcon fontSize="small" /></IconButton>
                                    <IconButton size="small" onClick={() => setDeleting(p)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                        {!packs.length && (
                            <TableRow><TableCell colSpan={6} align="center"><Typography variant="body2" color="text.secondary">还没有整合包</Typography></TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </Card>
            <PackDialog open={dialogOpen} workshopId={workshopId} initial={editing} modules={modules}
                onClose={() => setDialogOpen(false)} onSaved={onRefresh} notify={notify} />
            <ConfirmDialog open={!!deleting} danger title="删除整合包"
                text={deleting ? `确定删除「${deleting.title}」？` : ''}
                confirmLabel="删除" busy={busy} onClose={() => setDeleting(null)} onConfirm={remove} />
        </Box>
    );
}

function HostingTab({ workshop, onSaved, notify }) {
    const [mode, setMode] = useState(workshop.itemsMode);
    const [externalUrl, setExternalUrl] = useState(workshop.externalItemsUrl || '');
    const [serveItems, setServeItems] = useState(workshop.serveItems);
    const [serveAssets, setServeAssets] = useState(workshop.serveAssets);
    const [level, setLevel] = useState('zip');
    const [source, setSource] = useState('published');
    const [busy, setBusy] = useState(false);

    const save = async () => {
        setBusy(true);
        try {
            await api.patch(`/api/workshops/${workshop.id}/hosting`, { itemsMode: mode, externalItemsUrl: externalUrl });
            await api.patch(`/api/workshops/${workshop.id}/visibility`, { serveItems, serveAssets });
            onSaved();
            notify('托管设置已保存（模式/地址在下次发布后生效）');
        } catch (e) {
            notify(e.message, 'error');
        } finally { setBusy(false); }
    };
    const download = async (kind) => {
        try {
            const base = `/api/workshops/${workshop.id}`;
            if (kind === 'zip') await api.download(`${base}/export.zip?level=${level}&source=${source}`, `${workshop.slug}-${level}.zip`);
            else await api.download(`${base}/export/${kind}.json?level=${level}&source=${source}`, `${workshop.slug}-${kind}.json`);
            notify('已开始下载');
        } catch (e) {
            notify(e.message, 'error');
        }
    };

    return (
        <Stack spacing={2}>
            <Card elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                <CardContent>
                    <Typography variant="h6" sx={{ mb: 1 }}>托管</Typography>
                    <FormControl>
                        <FormLabel>items 地址</FormLabel>
                        <RadioGroup value={mode} onChange={e => setMode(e.target.value)}>
                            <FormControlLabel value="server" control={<Radio size="small" />}
                                label="本服务器托管（/w/<slug>/items.json + assets）" />
                            <FormControlLabel value="external" control={<Radio size="small" />}
                                label="外部 CDN（目录头 url 指向下面的地址）" />
                        </RadioGroup>
                    </FormControl>
                    {mode === 'external' && (
                        <TextField size="small" fullWidth sx={{ mt: 1 }} label="外部 items.json 地址"
                            placeholder="https://cdn.example.com/demo/items.json"
                            value={externalUrl} onChange={e => setExternalUrl(e.target.value)} />
                    )}
                    <Stack direction="row" spacing={3} sx={{ mt: 2 }}>
                        <FormControlLabel control={<Switch checked={serveItems} onChange={e => setServeItems(e.target.checked)} />}
                            label="公开 items.json" />
                        <FormControlLabel control={<Switch checked={serveAssets} onChange={e => setServeAssets(e.target.checked)} />}
                            label="公开 assets" />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        模式/外部地址修改后需要重新发布；公开开关即时生效。ws.json（目录索引）始终公开。
                    </Typography>
                    <Box sx={{ mt: 2 }}>
                        <Button variant="contained" disableElevation startIcon={<SaveIcon />} disabled={busy} onClick={save}>
                            {busy ? '保存中…' : '保存托管设置'}
                        </Button>
                    </Box>
                </CardContent>
            </Card>
            <Card elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                <CardContent>
                    <Typography variant="h6" sx={{ mb: 1 }}>导出</Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                        <FormControl size="small" sx={{ minWidth: 220 }}>
                            <InputLabel>合并档位</InputLabel>
                            <Select value={level} label="合并档位" onChange={e => setLevel(e.target.value)}>
                                <MenuItem value="zip">ZIP：分离文件</MenuItem>
                                <MenuItem value="icons">JSON：仅图标内联</MenuItem>
                                <MenuItem value="inline">JSON：全部内联（单文件内容源）</MenuItem>
                            </Select>
                        </FormControl>
                        <FormControl size="small" sx={{ minWidth: 180 }}>
                            <InputLabel>来源</InputLabel>
                            <Select value={source} label="来源" onChange={e => setSource(e.target.value)}>
                                <MenuItem value="published">当前发布</MenuItem>
                                <MenuItem value="draft">当前草稿（下一版）</MenuItem>
                            </Select>
                        </FormControl>
                        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => download('zip')}>下载 ZIP</Button>
                        <Button variant="outlined" onClick={() => download('ws')}>下载 ws.json</Button>
                        <Button variant="outlined" onClick={() => download('items')}>下载 items.json</Button>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, lineHeight: 1.7 }}>
                        · ZIP：ws.json + items.json + scripts/icons/packs，整个目录上传即可。<br />
                        · 仅图标内联：脚本/包仍指向本服务器 assets，请保持“公开 assets”。<br />
                        · 全部内联：只需上传 items.json 到 CDN；目录索引 ws.json 仍单独一份（两文件版）。<br />
                        · 全内联 items.json 上限 512KB；超出改用 ZIP。
                    </Typography>
                </CardContent>
            </Card>
        </Stack>
    );
}

function HistoryTab({ workshopId, releases, current, onRefresh, notify }) {
    const [viewing, setViewing] = useState(null);
    const [rolling, setRolling] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const [busy, setBusy] = useState(false);

    const view = async (r) => {
        try {
            const data = await api.get(`/api/workshops/${workshopId}/releases/${r.revision}`);
            setViewing({ revision: r.revision, data });
        } catch (e) { notify(e.message, 'error'); }
    };
    const rollback = async () => {
        setBusy(true);
        try {
            const r = await api.post(`/api/workshops/${workshopId}/releases/${rolling.revision}/rollback`, { note: `回滚自 v${rolling.revision}` });
            notify(`已生成新修订 v${r.revision}`);
            onRefresh();
        } catch (e) {
            notify(e.message, 'error');
        } finally { setBusy(false); setRolling(null); }
    };
    const remove = async () => {
        setBusy(true);
        try {
            await api.del(`/api/workshops/${workshopId}/releases/${deleting.revision}`);
            notify(`已删除旧版本 v${deleting.revision}`);
            onRefresh();
        } catch (e) {
            notify(e.message, 'error');
        } finally { setBusy(false); setDeleting(null); }
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', mb: 2 }}>
                <Typography variant="h6" sx={{ flex: 1 }}>发布历史</Typography>
                <IconButton onClick={onRefresh}><RefreshIcon /></IconButton>
            </Box>
            <Card elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                <Table size="small">
                    <TableHead>
                        <TableRow><TableCell>版本</TableCell><TableCell>说明</TableCell><TableCell>时间</TableCell><TableCell>items 字节</TableCell><TableCell align="right">操作</TableCell></TableRow>
                    </TableHead>
                    <TableBody>
                        {releases.map(r => (
                            <TableRow key={r.revision} hover>
                                <TableCell>
                                    <Chip size="small" label={`v${r.revision}`} />
                                    {r.revision === current && <Chip size="small" variant="outlined" color="primary" label="当前" sx={{ ml: 0.5 }} />}
                                </TableCell>
                                <TableCell>{r.note || '—'}</TableCell>
                                <TableCell>{new Date(r.created_at).toLocaleString()}</TableCell>
                                <TableCell>{r.items_bytes}</TableCell>
                                <TableCell align="right">
                                    <Button size="small" onClick={() => view(r)}>查看</Button>
                                    <Button size="small" color="warning" onClick={() => setRolling(r)}>回滚</Button>
                                    <Button size="small" color="error" disabled={r.revision === current}
                                        onClick={() => setDeleting(r)}>删除</Button>
                                </TableCell>
                            </TableRow>
                        ))}
                        {!releases.length && (
                            <TableRow><TableCell colSpan={5} align="center"><Typography variant="body2" color="text.secondary">还没有发布记录</Typography></TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </Card>
            <Dialog open={!!viewing} onClose={() => setViewing(null)} fullWidth maxWidth="md">
                <DialogTitle>v{viewing?.revision} 发布内容</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="subtitle2">ws.json</Typography>
                    <pre className="json">{viewing ? JSON.stringify(viewing.data.manifest, null, 2) : ''}</pre>
                    <Typography variant="subtitle2" sx={{ mt: 2 }}>items.json</Typography>
                    <pre className="json">{viewing ? JSON.stringify(viewing.data.items, null, 2) : ''}</pre>
                </DialogContent>
                <DialogActions><Button onClick={() => setViewing(null)}>关闭</Button></DialogActions>
            </Dialog>
            <ConfirmDialog open={!!rolling} title="回滚"
                text={rolling ? `回滚到 v${rolling.revision} 会生成一个新的修订（v${rolling.revision} 之后的最新版本），不会改写历史。` : ''}
                confirmLabel="回滚" busy={busy} onClose={() => setRolling(null)} onConfirm={rollback} />
            <ConfirmDialog open={!!deleting} danger title="删除旧版本"
                text={deleting ? `删除 v${deleting.revision} 的发布记录？当前公开版本不受影响；已上传的资源文件不会删除。` : ''}
                confirmLabel="删除" busy={busy} onClose={() => setDeleting(null)} onConfirm={remove} />
        </Box>
    );
}

// ── 主页面 ────────────────────────────────────────────────────────────────

export default function WorkshopPage({ session, onLogout, notify }) {
    const { id } = useParams();
    const navigate = useNavigate();
    const [workshop, setWorkshop] = useState(null);
    const [modules, setModules] = useState([]);
    const [packs, setPacks] = useState([]);
    const [releases, setReleases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [tab, setTab] = useState('overview');
    const [publishOpen, setPublishOpen] = useState(false);

    const load = async () => {
        setLoading(true);
        setErr(null);
        try {
            const [w, m, p, r] = await Promise.all([
                api.get(`/api/workshops/${id}`),
                api.get(`/api/workshops/${id}/modules`),
                api.get(`/api/workshops/${id}/packs`),
                api.get(`/api/workshops/${id}/releases`),
            ]);
            setWorkshop(w.workshop);
            setModules(m.modules);
            setPacks(p.packs);
            setReleases(r.releases);
        } catch (e) {
            setErr(e.message);
            if (e.status === 404) navigate('/');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, [id]);

    if (loading) return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
    if (err || !workshop) return (
        <Box sx={{ p: 4 }}>
            <Alert severity="error">{err || '工坊不存在'}</Alert>
            <Button sx={{ mt: 2 }} onClick={() => navigate('/')}>返回</Button>
        </Box>
    );

    const tabIndex = ['overview', 'modules', 'packs', 'hosting', 'history'].indexOf(tab);

    return (
        <Box sx={{ minHeight: '100vh' }}>
            <AppBar position="static" elevation={0} sx={{ bgcolor: '#102243' }}>
                <Toolbar>
                    <IconButton color="inherit" onClick={() => navigate('/')}><ArrowBackIcon /></IconButton>
                    <Box sx={{ minWidth: 0, flex: 1, ml: 1 }}>
                        <Typography variant="h6" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>{workshop.name}</Typography>
                        <Typography variant="caption" sx={{ opacity: 0.7 }}>/w/{workshop.slug}/ws.json</Typography>
                    </Box>
                    <CopyButton text={workshop.sourceUrl} notify={notify} />
                    <Button color="inherit" startIcon={<PublishIcon />} onClick={() => setPublishOpen(true)}>发布</Button>
                    <Typography variant="body2" sx={{ opacity: 0.75, mx: 2 }}>{session.username}</Typography>
                    <IconButton color="inherit" onClick={onLogout}><LogoutIcon /></IconButton>
                </Toolbar>
            </AppBar>
            <Box sx={{ maxWidth: 1150, mx: 'auto', p: { xs: 2, md: 3 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                    {workshop.publishedRevision
                        ? <Chip size="small" color="primary" variant="outlined" label={`已发布 v${workshop.publishedRevision}`} />
                        : <Chip size="small" label="未发布" />}
                    {workshop.draftDirty && <Chip size="small" color="warning" label="有未发布改动" />}
                    <Box sx={{ flex: 1 }} />
                    <Button size="small" startIcon={<RefreshIcon />} onClick={load}>刷新</Button>
                </Box>
                <Tabs value={tabIndex} onChange={(_, i) => setTab(['overview', 'modules', 'packs', 'hosting', 'history'][i])}
                    variant="scrollable" sx={{ mb: 2, borderBottom: '1px solid #e2e8f0' }}>
                    <Tab label="概览" />
                    <Tab label={`模块（${modules.length}）`} />
                    <Tab label={`整合包（${packs.length}）`} />
                    <Tab label="托管 / 导出" />
                    <Tab label="发布历史" />
                </Tabs>
                {tab === 'overview' && <OverviewTab workshop={workshop} onSaved={load} notify={notify} navigate={navigate} />}
                {tab === 'modules' && <ModulesTab workshopId={workshop.id} modules={modules} onRefresh={load} notify={notify} />}
                {tab === 'packs' && <PacksTab workshopId={workshop.id} packs={packs} modules={modules} onRefresh={load} notify={notify} />}
                {tab === 'hosting' && <HostingTab workshop={workshop} onSaved={load} notify={notify} />}
                {tab === 'history' && <HistoryTab workshopId={workshop.id} releases={releases}
                    current={workshop.publishedRevision} onRefresh={load} notify={notify} />}
            </Box>
            <PublishDialog open={publishOpen} workshopId={workshop.id}
                onClose={() => setPublishOpen(false)} onPublished={load} notify={notify} />
        </Box>
    );
}
