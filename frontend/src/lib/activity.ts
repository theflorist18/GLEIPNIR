// M25b: one renderer for the case audit log, shared by CaseDetailPage and
// LeadDashboardPage so every event type reads the same everywhere. Unknown
// types (the enum can grow) fall back to a generic line instead of vanishing.

import type { CaseActivityEvent } from '../types';
import type { TimelineItem } from '../components/ui/Timeline';

// Every type not listed here is 'accent'.
const TONES: Record<string, TimelineItem['tone']> = {
  CASE_CREATED: 'ok',
  PARTICIPANT_REMOVED: 'muted',
  CATEGORY_DELETED: 'muted',
  EVIDENCE_ADDED: 'ok',
  EVIDENCE_ASSIGNED: 'ok',
  EVIDENCE_UNASSIGNED: 'muted',
  EVIDENCE_REMOVED: 'muted',
  NOTE_ADDED: 'muted',
};

export function activityTone(e: CaseActivityEvent): TimelineItem['tone'] {
  return TONES[e.type] ?? 'accent';
}

const s = (v: unknown): string => (v === null || v === undefined ? '?' : String(v));

export function activityLine(e: CaseActivityEvent): string {
  const actor = e.actor || 'someone';
  const d = e.detail ?? {};
  switch (e.type) {
    case 'CASE_CREATED': return `${actor} created the case`;
    case 'CASE_UPDATED': return `${actor} updated the case${d.status ? ` (status ${s(d.status)})` : ''}`;
    case 'PARTICIPANT_ADDED': return `${actor} added ${s(e.target)} as ${s(d.roleInCase)}`;
    case 'PARTICIPANT_REMOVED': return `${actor} removed ${s(e.target)} from the team`;
    case 'PARTICIPANT_ROLE_CHANGED': return `${actor} changed ${s(e.target)}'s role: ${s(d.from)} → ${s(d.to)}`;
    case 'CATEGORY_CREATED': return `${actor} added category "${s(d.name)}"`;
    case 'CATEGORY_RENAMED': return `${actor} renamed category "${s(d.from)}" → "${s(d.to)}"`;
    case 'CATEGORY_DELETED': return `${actor} deleted category "${s(d.name)}"`;
    case 'EVIDENCE_ADDED': return `${actor} added evidence${d.label ? ` ${s(d.label)}` : ''}`;
    case 'EVIDENCE_ASSIGNED': return `${actor} assigned evidence to the case`;
    case 'EVIDENCE_UNASSIGNED': return `${actor} unassigned evidence from the case`;
    case 'EVIDENCE_REMOVED': return `${actor} removed evidence${d.label ? ` ${s(d.label)}` : ''}`;
    case 'EVIDENCE_DETAILS_UPDATED': {
      const fields = Array.isArray(d.fields) ? (d.fields as unknown[]).map(s).join(', ') : '';
      return `${actor} updated evidence details${fields ? ` (${fields})` : ''}`;
    }
    case 'FLAG_CHANGED': return d.to ? `${actor} flagged evidence: ${s(d.to)}` : `${actor} cleared the evidence flag`;
    case 'NOTE_ADDED': return `${actor} added an examiner note`;
    default: return `${actor}: ${e.type}`;
  }
}
