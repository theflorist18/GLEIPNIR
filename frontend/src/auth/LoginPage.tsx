import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { GatewayError } from '../api';

export function LoginPage() {
  const { login, user, ready } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
      else if (e2 instanceof GatewayError && e2.status === 503) setErr('User login is not configured on this gateway.');
      else setErr(String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card form login-card" onSubmit={submit}>
        <div className="brand">GLEIPNIR</div>
        <p className="hint">Evidence library · sign in to continue</p>
        <label>username<input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button type="submit" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {err && <div className="err">{err}</div>}
      </form>
    </div>
  );
}
