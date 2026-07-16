import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="card page-narrow">
      <h3>Page not found</h3>
      <Link to="/cases">Back to my cases</Link>
    </div>
  );
}
