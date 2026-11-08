import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AppBar, Toolbar, Typography, Box, Button, Card, CardContent, CardActions,
    Chip, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Stack, Alert, CircularProgress, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import LogoutIcon from '@mui/icons-material/Logout';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { api } from '../api.js';

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

export default function WorkshopsPage({ session, onLogout, notify }) {
    const navigate = useNavigate();
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [form, setForm] = useState({ slug: '', name: '', description: '' });
    const [busy, setBusy] = useState(false);

    const load = async () => {
        setLoading(true);
        setErr(null);
        try {
            const r = await api.get('/api/workshops');
            setList(r.workshops);
        } catch (e) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    const create = async () => {
        setBusy(true);
        setErr(null);
        try {
            const r = await api.post('/api/workshops', form);
            setCreateOpen(false);
            setForm({ slug: '', name: '', description: '' });
            navigate(`/w/${r.workshop.id}`);
        } catch (e) {
            setErr(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box sx={{ minHeight: '100vh' }}>
            <AppBar position="static" elevation={0} sx={{ bgcolor: '#102243' }}>
                <Toolbar>
                    <Typography variant="h6" sx={{ flex: 1, fontWeight: 600 }}>Pico 工坊工作室</Typography>
                    <Typography variant="body2" sx={{ opacity: 0.75, mr: 2 }}>{session.username}</Typography>
                    <Tooltip title="退出登录">
                        <IconButton color="inherit" onClick={onLogout}><LogoutIcon /></IconButton>
                    </Tooltip>
                </Toolbar>
            </AppBar>
            <Box sx={{ maxWidth: 1100, mx: 'auto', p: { xs: 2, md: 4 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>我的工坊</Typography>
                    <Button variant="contained" disableElevation startIcon={<AddIcon />}
                        onClick={() => setCreateOpen(true)}>新建工坊</Button>
                </Box>
                {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
                {loading ? (
                    <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
                ) : list.length === 0 ? (
                    <Card elevation={0} sx={{ border: '1px dashed #cbd5e1', bgcolor: 'transparent' }}>
                        <CardContent sx={{ textAlign: 'center', py: 8 }}>
                            <Typography color="text.secondary">还没有工坊。新建一个，开始整理模块和整合包。</Typography>
                        </CardContent>
                    </Card>
                ) : (
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 2 }}>
                        {list.map(w => (
                            <Card key={w.id} elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                                <CardContent>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                        <Typography variant="h6" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
                                            {w.name}
                                        </Typography>
                                        {w.publishedRevision > 0
                                            ? <Chip size="small" label={`v${w.publishedRevision}`} color="primary" variant="outlined" />
                                            : <Chip size="small" label="未发布" />}
                                        {w.draftDirty && <Chip size="small" label="有改动" color="warning" />}
                                    </Box>
                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                        /w/{w.slug}/ws.json
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                        {w.moduleCount} 个模块 · {w.packCount} 个整合包
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                                        <Tooltip title="复制公开源地址">
                                            <IconButton size="small" onClick={async () => {
                                                if (await copyText(w.sourceUrl)) notify('已复制源地址');
                                                else notify('复制失败', 'error');
                                            }}><ContentCopyIcon fontSize="small" /></IconButton>
                                        </Tooltip>
                                    </Box>
                                </CardContent>
                                <CardActions sx={{ px: 2, pb: 2 }}>
                                    <Button size="small" variant="contained" disableElevation
                                        endIcon={<OpenInNewIcon />} onClick={() => navigate(`/w/${w.id}`)}>
                                        打开
                                    </Button>
                                </CardActions>
                            </Card>
                        ))}
                    </Box>
                )}
            </Box>

            <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle>新建工坊</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <TextField label="slug" size="small" fullWidth value={form.slug}
                            helperText="公开地址 /w/<slug>/ws.json；只能小写字母/数字/连字符，发布后不建议修改"
                            onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} />
                        <TextField label="名称" size="small" fullWidth value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })} />
                        <TextField label="说明（可选）" size="small" fullWidth multiline minRows={2}
                            value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })} />
                        {err && <Alert severity="error">{err}</Alert>}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCreateOpen(false)}>取消</Button>
                    <Button variant="contained" disableElevation disabled={busy || !form.slug || !form.name}
                        onClick={create}>{busy ? '创建中…' : '创建'}</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
