import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Icon, type IconName } from '../ui/Icon';

// Role-aware navigation: everyone gets the library pages; groups the user
// cannot use are not rendered at all (the routes are additionally
// RequireRole-guarded).
function Item({ to, icon, label }: { to: string; icon: IconName; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
      <Icon name={icon} size={18} />{label}
    </NavLink>
  );
}

export function Sidebar() {
  const { user } = useAuth();
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="nav-title">Library</div>
      <Item to="/ingest" icon="nav-ingest" label="Ingest evidence" />
      <Item to="/cases" icon="nav-cases" label="My cases" />
      <Item to="/search" icon="nav-search" label="Search" />
      {user?.role === 'lead' && (
        <>
          <div className="nav-title">Lead</div>
          <Item to="/lead/dashboard" icon="nav-lead-dashboard" label="Dashboard" />
        </>
      )}
      {user?.role === 'admin' && (
        <>
          <div className="nav-title">Administration</div>
          <Item to="/admin/users" icon="nav-users" label="Users" />
          <Item to="/admin/cases" icon="nav-case-admin" label="Case admin" />
        </>
      )}
    </nav>
  );
}
