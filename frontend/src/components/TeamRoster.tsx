import { useState } from 'react';
import { ALL_CASE_ROLES, CASE_ROLE_LABELS } from '../roles';
import type { CaseParticipant, CaseRole, User } from '../types';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';

// M25 case-team roster, shared by CaseDetailPage (Team section) and
// LeadDashboardPage (My team): the participant list with in-place role change
// and remove, plus the add-member modal fed by the user directory.
export function RosterList({ participants, manage, label, onRole, onRemove }: {
  participants: CaseParticipant[];
  manage: boolean;
  label: (userId: string) => string; // aria-label of the role select
  onRole: (userId: string, role: CaseRole) => void;
  onRemove: (userId: string) => void;
}) {
  return (
    <ul className="plain-list">
      {participants.map((p) => (
        <li key={p.userId}>
          <span>
            {p.userId}{' '}
            <Badge tone={p.roleInCase === 'lead' ? 'warn' : 'muted'}>{CASE_ROLE_LABELS[p.roleInCase]}</Badge>
          </span>
          {manage && (
            <span className="btn-row">
              <select
                value={p.roleInCase}
                aria-label={label(p.userId)}
                onChange={(e) => onRole(p.userId, e.target.value as CaseRole)}
              >
                {ALL_CASE_ROLES.map((r) => <option key={r} value={r}>{CASE_ROLE_LABELS[r]}</option>)}
              </select>
              <button className="small" onClick={() => onRemove(p.userId)}>Remove</button>
            </span>
          )}
        </li>
      ))}
      {participants.length === 0 && <li className="muted small">No participants yet.</li>}
    </ul>
  );
}

export function AddMemberModal({ title, roster, directory, onAdd, onClose, err }: {
  title: string;
  roster: CaseParticipant[];
  directory: User[];
  onAdd: (userId: string, role: CaseRole) => void;
  onClose: () => void;
  err: string;
}) {
  const [pUser, setPUser] = useState('');
  const [pRole, setPRole] = useState<CaseRole>('viewer');
  // Candidates: active users not yet on the roster; the case-lead role can
  // only be granted to users holding the global lead role (server-enforced —
  // the picker just avoids offering a guaranteed 400).
  const candidates = directory.filter((u) =>
    !roster.some((p) => p.userId === u.username)
    && (pRole !== 'lead' || u.role === 'lead'));
  return (
    <Modal title={title} onClose={onClose}>
      <div className="form">
        <label>user
          <select value={pUser} onChange={(e) => setPUser(e.target.value)}>
            <option value="">— pick a user —</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.username}>{u.username}{u.name && u.name !== u.username ? ` — ${u.name}` : ''} ({u.role})</option>
            ))}
          </select>
        </label>
        {candidates.length === 0 && <p className="hint">{pRole === 'lead' ? 'No global-lead users are available to add.' : 'Every active user is already on this roster.'}</p>}
        <label>role in case
          <select value={pRole} onChange={(e) => { const r = e.target.value as CaseRole; setPRole(r); if (r === 'lead' && !directory.some((u) => u.username === pUser && u.role === 'lead')) setPUser(''); }}>
            {ALL_CASE_ROLES.map((r) => <option key={r} value={r}>{CASE_ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        <div className="btn-row">
          <button disabled={!pUser} onClick={() => onAdd(pUser, pRole)}>Grant access</button>
          <button className="small" onClick={onClose}>Cancel</button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    </Modal>
  );
}
