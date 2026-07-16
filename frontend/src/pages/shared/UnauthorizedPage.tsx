import { Link } from 'react-router-dom';

export function UnauthorizedPage() {
  return (
    <div className="card page-narrow">
      <h3>Not authorized</h3>
      <p className="muted">This page requires the admin role.</p>
      <Link to="/cases">Back to my cases</Link>
    </div>
  );
}
