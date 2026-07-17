import type { CaseRole, Role } from './types';

// Display labels for the 3-tier RBAC model (M18). Wire values stay lowercase
// ('admin' | 'lead' | 'investigator'); every page renders through these so no
// component hardcodes role strings.
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'System Administrator',
  lead: 'Lead Investigator',
  investigator: 'Investigator',
};

export const CASE_ROLE_LABELS: Record<CaseRole, string> = {
  viewer: 'Viewer',
  contributor: 'Contributor',
  lead: 'Case Lead',
};

export const ALL_ROLES: Role[] = ['admin', 'lead', 'investigator'];
export const ALL_CASE_ROLES: CaseRole[] = ['viewer', 'contributor', 'lead'];
