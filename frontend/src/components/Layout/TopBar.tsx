import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ROLE_LABELS } from '../../roles';
import { applyTheme, storedTheme, type Theme } from '../../lib/theme';
import { Avatar } from '../ui/Chips';
import { BrandMark, Icon } from '../ui/Icon';

// Top bar (Claude Design screen 02): the horizontal lockup linking home, and
// a user menu (disclosure, not an ARIA menu) with the identity, the theme
// choice and Sign out.
export function TopBar() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const signOut = async () => {
    await logout();
    nav('/login');
  };
  const pickTheme = (t: Theme) => { applyTheme(t); setTheme(t); };
  const display = user ? user.name || user.username : '';

  return (
    <header className="topbar">
      <Link to="/cases" className="brand-lockup" aria-label="GLEIPNIR evidence library — my cases">
        <BrandMark size={24} />
        <span className="wordmark">GLEIPNIR</span>
        <span className="lockup-rule" aria-hidden="true" />
        <span className="descriptor">evidence library</span>
      </Link>
      {user && (
        <div className="user-menu" ref={ref}>
          <button className="user-chip" aria-expanded={open} aria-controls="user-menu" onClick={() => setOpen((o) => !o)}>
            <Avatar name={display} seed={user.username} size={28} ring={user.role === 'lead'} />
            <span>{display}</span>
            <span className={`role-badge role-${user.role}`}>{ROLE_LABELS[user.role]}</span>
            <Icon name="chevron-down" />
          </button>
          {open && (
            <div className="menu" id="user-menu">
              <div className="menu-head">
                <strong>{display}</strong>
                <span className="mono small muted">{user.username}</span>
              </div>
              <div className="theme-picker" role="group" aria-label="Theme">
                <span>Theme</span>
                {(['system', 'light', 'dark'] as Theme[]).map((t) => (
                  <button key={t} aria-pressed={theme === t} onClick={() => pickTheme(t)}>{t}</button>
                ))}
              </div>
              <button className="btn-secondary" onClick={() => void signOut()}><Icon name="sign-out" />Sign out</button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
