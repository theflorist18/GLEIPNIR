import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GatewayClient } from '../api';
import type { User } from '../types';

// Session state for the whole SPA (M14). The opaque session token from
// POST /auth/login is kept in sessionStorage so a refresh and deep-link survive
// but the credential dies with the tab and is not shared across windows (S13);
// any 401 from the gateway drops the session (gateway restarts wipe sessions
// server-side, so the client must treat them as disposable). The GatewayClient
// lives here — it needs the token getter — and replaces the client settings.tsx
// used to own when auth was a hand-typed static token.
//
// sessionStorage over localStorage narrows the XSS/shared-workstation exposure
// of a role-carrying bearer token; the token is never an HttpOnly cookie by
// design (the gateway is header-authenticated per CONTRACTS §6, and a cookie
// would add CSRF surface). One-time migration clears any token a prior build
// left in localStorage.
const TOKEN_KEY = 'gleipnir.session';
try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage may be unavailable */ }

interface Auth {
  user: User | null;
  ready: boolean; // initial session restore finished
  client: GatewayClient;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const tokenRef = useRef<string>(sessionStorage.getItem(TOKEN_KEY) ?? '');

  const clearSession = useCallback(() => {
    tokenRef.current = '';
    sessionStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  const client = useMemo(
    () => new GatewayClient({ getToken: () => tokenRef.current, onUnauthorized: clearSession }),
    [clearSession],
  );

  // Restore the session once on mount: a stored token is only trusted after
  // /auth/me confirms it (it may have expired or the user been deactivated).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (tokenRef.current) {
        try {
          const me = await client.me();
          if (alive) setUser(me);
        } catch {
          /* 401 already cleared the session; other errors stay logged out */
        }
      }
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, [client]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await client.login(username, password);
    tokenRef.current = res.token;
    sessionStorage.setItem(TOKEN_KEY, res.token);
    setUser(res.user);
  }, [client]);

  const logout = useCallback(async () => {
    try {
      await client.logout();
    } catch {
      /* the session may already be dead server-side — clearing locally is enough */
    }
    clearSession();
  }, [client, clearSession]);

  const value = useMemo(() => ({ user, ready, client, login, logout }), [user, ready, client, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
