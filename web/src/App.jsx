import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline, Snackbar, Alert } from '@mui/material';
import { api, setCsrfToken } from './api.js';
import LoginPage from './pages/LoginPage.jsx';
import WorkshopsPage from './pages/WorkshopsPage.jsx';
import WorkshopPage from './pages/WorkshopPage.jsx';

const theme = createTheme({
    palette: { mode: 'light', primary: { main: '#2563eb' }, background: { default: '#f4f6f8' } },
    shape: { borderRadius: 8 },
    typography: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif' },
});

export default function App() {
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [snack, setSnack] = useState(null);

    const notify = (message, severity = 'success') => setSnack({ message, severity, key: Date.now() });
    const logout = async () => {
        try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
        setCsrfToken('');
        setSession(null);
    };

    useEffect(() => {
        (async () => {
            try {
                const s = await api.get('/api/auth/session');
                setCsrfToken(s.csrfToken);
                setSession(s);
            } catch {
                setSession(null);
            } finally {
                setLoading(false);
            }
        })();
        const onUnauth = () => { setCsrfToken(''); setSession(null); };
        window.addEventListener('pws-unauthorized', onUnauth);
        return () => window.removeEventListener('pws-unauthorized', onUnauth);
    }, []);

    if (loading) return null;

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {!session ? (
                <LoginPage onLogin={(s) => { setCsrfToken(s.csrfToken); setSession(s); }} />
            ) : (
                <Routes>
                    <Route path="/" element={<WorkshopsPage session={session} onLogout={logout} notify={notify} />} />
                    <Route path="/w/:id" element={<WorkshopPage session={session} onLogout={logout} notify={notify} />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            )}
            <Snackbar
                open={!!snack}
                autoHideDuration={4000}
                onClose={() => setSnack(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                {snack ? (
                    <Alert severity={snack.severity} onClose={() => setSnack(null)} sx={{ width: '100%' }}>
                        {snack.message}
                    </Alert>
                ) : <span />}
            </Snackbar>
        </ThemeProvider>
    );
}
