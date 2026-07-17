import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { GatewayError } from '../api';

// Credentials are handled only here: sent as a JSON POST body over the
// gateway's login route (never query params, never logged), exchanged for an
// opaque session token. The page guard is UX — the API enforces auth on every
// route, with a server-side per-user throttle against brute force.

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.6" />
      {off && <line x1="4" y1="20" x2="20" y2="4" />}
    </svg>
  );
}

export function LoginPage() {
  const { login, user, ready } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const from = (loc.state as { from?: string } | null)?.from ?? '/cases';
  if (ready && user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(username, password);
      nav(from, { replace: true });
    } catch (e2) {
      if (e2 instanceof GatewayError && e2.status === 401) setErr('Invalid username or password.');
      else if (e2 instanceof GatewayError && e2.status === 429) setErr('Too many failed attempts — wait a moment and try again.');
      else if (e2 instanceof GatewayError && e2.status === 503) setErr('User login is not configured on this gateway.');
      else setErr('Could not reach the gateway. Is the network up?');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">GLEIPNIR</div>
        <p className="login-sub">Evidence library · sign in to continue</p>

        <label className="login-field">
          <span>Username</span>
          <input
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <label className="login-field">
          <span>Password</span>
          <div className="pw-wrap">
            <input
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="pw-toggle"
              aria-label={showPw ? 'Hide password' : 'Show password'}
              title={showPw ? 'Hide password' : 'Show password'}
              onClick={() => setShowPw((v) => !v)}
              tabIndex={-1}
            >
              <EyeIcon off={showPw} />
            </button>
          </div>
        </label>

        <button type="submit" className="login-submit" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {err && <div className="err login-err">{err}</div>}
      </form>
      <p className="login-foot">Talks only to the API gateway · Hyperledger Fabric 2.5 LTS · localhost thesis demo</p>
    </div>
  );
}
