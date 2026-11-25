import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { api, TOKEN_KEY, USER_KEY, UNAUTHORIZED_EVENT } from '../services/api';

export const AuthContext = createContext(null);

const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* storage unavailable: session lasts until reload */ } };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => { try { return JSON.parse(read(USER_KEY) || 'null'); } catch { return null; } });
  const [token, setToken] = useState(() => read(TOKEN_KEY));
  const [loading, setLoading] = useState(Boolean(read(TOKEN_KEY)));   // only "loading" when there is a stored token to verify

  const clear = useCallback(() => { setToken(null); setUser(null); write(TOKEN_KEY, null); write(USER_KEY, null); }, []);
  const store = useCallback((data) => {
    setToken(data.token); setUser(data.user);
    write(TOKEN_KEY, data.token); write(USER_KEY, JSON.stringify(data.user));
    return data.user;
  }, []);

  // Verify the stored token once on load. GET /api/me returns the user object itself.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!read(TOKEN_KEY)) { setLoading(false); return; }
      try {
        const me = await api.getMe();
        if (cancelled) return;
        setUser(me); write(USER_KEY, JSON.stringify(me));
      } catch (err) {
        if (cancelled) return;
        if (err.status === 401) clear();          // expired / signed out elsewhere
        // a network error keeps the cached user so the app can show a connection error instead of logging out
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [clear]);

  // Any API call that comes back 401 ends the session everywhere in the UI.
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, clear);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, clear);
  }, [clear]);

  const login = useCallback(async (email, password) => store(await api.login({ email, password })), [store]);
  const register = useCallback(async (payload) => store(await api.register(payload)), [store]);
  const replaceToken = useCallback((newToken) => { setToken(newToken); write(TOKEN_KEY, newToken); }, []);

  const value = useMemo(() => ({
    user, token, loading,
    isAuthenticated: Boolean(token && user),
    isTeacher: user?.role === 'teacher',
    isStudent: user?.role === 'student',
    login, register, logout: clear, replaceToken
  }), [user, token, loading, login, register, clear, replaceToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
