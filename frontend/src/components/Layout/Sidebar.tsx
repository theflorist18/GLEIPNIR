import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

// Role-aware navigation: everyone gets the library pages; the admin section
// only renders for admins (the routes are additionally RequireRole-guarded).
export function Sidebar() {
  const { user } = useAuth();
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');
  return (
    <nav className="sidebar">
      <div className="nav-group">
        <div className="nav-title">Library</div>
        <NavLink to="/ingest" className={cls}>Ingest evidence</NavLink>
        <NavLink to="/cases" end className={cls}>My cases</NavLink>
        <NavLink to="/search" className={cls}>Search</NavLink>
      </div>
      {user?.role === 'admin' && (
        <div className="nav-group">
          <div className="nav-title">Administration</div>
          <NavLink to="/admin/users" className={cls}>Users</NavLink>
          <NavLink to="/admin/cases" className={cls}>Case admin</NavLink>
          <NavLink to="/admin/dashboard" className={cls}>Dashboard</NavLink>
        </div>
      )}
    </nav>
  );
}
