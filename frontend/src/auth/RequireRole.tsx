import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import type { Role } from '../types';

// Route guard for role-gated pages (the server enforces the same rule — this
// is UX, not security). Accepts a set of roles since M18's 3-tier model has
// pages shared between tiers (e.g. lead + admin).
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return <>{children}</>;
}
