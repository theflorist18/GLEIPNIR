import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

// Top bar: brand + the signed-in identity. Replaces the old free-text token
// input — authentication is a real login now (M14).
export function TopBar() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const signOut = async () => {
    await logout();
    nav('/login');
  };
  return (
    <header className="topbar">
      <div className="brand">GLEIPNIR</div>
      <span className="tagline muted">evidence library</span>
      <div className="whoami">
        {user && (
          <span className="pill">
            {user.displayName || user.username} · {user.role}
          </span>
        )}
        <button className="small" onClick={signOut}>Sign out</button>
      </div>
    </header>
  );
}
