import React, { useState } from 'react';
import { Box, Paper, Typography, TextField, Button, Alert, Stack } from '@mui/material';
import { api } from '../api.js';

export default function LoginPage({ onLogin }) {
    const [username, setUsername] = useState('admin');
    const [password, setPassword] = useState('');
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e?.preventDefault();
        setBusy(true);
        setErr(null);
        try {
            const s = await api.post('/api/auth/login', { username, password });
            onLogin({ username: s.username, csrfToken: s.csrfToken, expiresAt: s.expiresAt });
        } catch (e2) {
            setErr(e2.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2 }}>
            <Paper elevation={0} sx={{ width: 380, p: 4, border: '1px solid #e2e8f0' }}>
                <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>Pico 工坊工作室</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    管理 Lua 创意工坊的模块、整合包与发布。
                </Typography>
                <Box component="form" onSubmit={submit}>
                    <Stack spacing={2}>
                        <TextField label="用户名" size="small" fullWidth value={username}
                            onChange={e => setUsername(e.target.value)} autoComplete="username" />
                        <TextField label="密码" size="small" fullWidth type="password" value={password}
                            onChange={e => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
                        {err && <Alert severity="error">{err}</Alert>}
                        <Button type="submit" variant="contained" disabled={busy || !password} disableElevation>
                            {busy ? '登录中…' : '登录'}
                        </Button>
                    </Stack>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3, lineHeight: 1.6 }}>
                    首次启动需要设置 ADMIN_PASSWORD（至少 12 位），
                    或先用 <code>node server/cli.js set-password</code> 初始化。
                </Typography>
            </Paper>
        </Box>
    );
}
