import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import type { Role } from '../types';

// Route guard for role-gated pages (the server enforces the same rule — this
// is UX, not security).
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || user.role !== role) return <Navigate to="/unauthorized" replace />;
  return <>{children}</>;
}
