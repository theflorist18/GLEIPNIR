import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { GatewayError } from '../api';
import { BrandMark, Icon, type IconName } from '../components/ui/Icon';

// Credentials are handled only here: sent as a JSON POST body over the
// gateway's login route (never query params, never logged), exchanged for an
// opaque session token. The page guard is UX — the API enforces auth on every
// route, with a server-side per-user throttle against brute force.

function loginError(e: unknown): { text: string; icon: IconName } {
  if (e instanceof GatewayError && e.status === 401) return { text: 'Invalid username or password.', icon: 'x-circle' };
  if (e instanceof GatewayError && e.status === 429) return { text: 'Too many failed attempts — wait a moment and try again.', icon: 'clock' };
  if (e instanceof GatewayError && e.status === 503) return { text: 'User login is not configured on this gateway.', icon: 'x-circle' };
  return { text: 'Could not reach the gateway. Is the network up?', icon: 'offline' };
}

export function LoginPage() {
  const { login, user, ready, sessionEnded } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<{ text: string; icon: IconName } | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (loc.state as { from?: string } | null)?.from ?? '/cases';
  if (ready && user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(username, password);
      nav(from, { replace: true });
    } catch (e2) {
      setErr(loginError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <span className="login-backdrop a" aria-hidden="true"><BrandMark size={900} /></span>
      <span className="login-backdrop b" aria-hidden="true"><BrandMark size={620} /></span>
      <form className="login-card" onSubmit={submit}>
        <div className="lockup-stacked">
          <BrandMark size={56} />
          <span className="wordmark">GLEIPNIR</span>
          <span className="login-sub">Evidence library · sign in to continue</span>
        </div>

        {sessionEnded && !err && (
          <div className="alert alert-info" role="status"><Icon name="clock" />Your session ended — sign in again.</div>
        )}

        <label className="login-field">
          Username
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
          Password
          <span className="pw-wrap">
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
              <Icon name={showPw ? 'eye-off' : 'eye'} size={18} />
            </button>
          </span>
        </label>

        <button type="submit" className="login-submit" disabled={busy || !username || !password}>
          {busy ? <><Icon name="spinner" />Signing in…</> : 'Sign in'}
        </button>
        <div className="login-live" aria-live="polite">
          {err && <div className="alert alert-error"><Icon name={err.icon} />{err.text}</div>}
        </div>
      </form>
      <p className="login-foot">Talks only to the API gateway · Hyperledger Fabric 2.5 LTS · localhost thesis demo</p>
    </div>
  );
}
