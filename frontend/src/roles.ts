import type { CaseRole, EvidenceFlag, Role } from './types';

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

// M20 evidence triage flag labels (case + evidence pages); FLAGS keeps this order.
export const FLAG_LABEL: Record<Exclude<EvidenceFlag, null>, string> = {
  HIGH_PRIORITY: 'High priority',
  PROCESSED: 'Processed',
  NEEDS_LEAD_REVIEW: 'Needs lead review',
};
export const FLAGS = Object.keys(FLAG_LABEL) as Array<Exclude<EvidenceFlag, null>>;
