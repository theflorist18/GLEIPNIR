import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useErr } from '../../hooks/useErr';
import { ALL_CASE_ROLES, CASE_ROLE_LABELS } from '../../roles';
import { activityLine, activityTone } from '../../lib/activity';
import { formatTs } from '../../lib/format';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Timeline } from '../../components/ui/Timeline';
import type { CaseActivityEvent, CaseParticipant, CaseRole, CaseSummary, EvidenceIndexRow, User } from '../../types';
import { StatusPill } from '../../components/ui/Chips';

interface CaseTeam {
  caseId: string;
  caseName: string;
  participants: CaseParticipant[];
}

// M24: the Lead Investigator's home — the cases they lead, evidence flagged
// for their attention, and the team's recent activity (merged M20 feeds).
// M25 adds the team roster with add/remove, per led case.
// Admins can reach it by URL; the sidebar links it for leads.
export function LeadDashboardPage() {
  const { client, user } = useAuth();
  const { msg, run } = useErr();
  const teamErr = useErr();
  const [leadCases, setLeadCases] = useState<CaseSummary[]>([]);
  const [flagged, setFlagged] = useState<EvidenceIndexRow[]>([]);
  const [activity, setActivity] = useState<Array<CaseActivityEvent & { caseId: string; caseName: string }>>([]);
  const [teams, setTeams] = useState<CaseTeam[]>([]);
  const [directory, setDirectory] = useState<User[]>([]);

  const [addingTo, setAddingTo] = useState<CaseTeam | null>(null);
  const [pUser, setPUser] = useState('');
  const [pRole, setPRole] = useState<CaseRole>('viewer');

  const loadTeams = async (mine: CaseSummary[]) => {
    const rosters = await Promise.all(mine.slice(0, 10).map(async (c) => {
      try {
        const detail = await client.getCase(c.id);
        return { caseId: c.id, caseName: c.name, participants: detail.participants };
      } catch {
        return { caseId: c.id, caseName: c.name, participants: [] };
      }
    }));
    setTeams(rosters);
  };

  useEffect(() => {
    void run(async () => {
      const cases = await client.listCases();
      const mine = cases.filter((c) => c.myRoleInCase === 'lead' || user?.role === 'admin');
      setLeadCases(mine);

      // Flagged evidence needing the lead's eye — server-scoped to what the
      // caller may see (visibleToUserId), so no over-reporting.
      const [review, priority] = await Promise.all([
        client.searchEvidence({ flag: 'NEEDS_LEAD_REVIEW' }),
        client.searchEvidence({ flag: 'HIGH_PRIORITY' }),
      ]);
      const seen = new Set<string>();
      setFlagged([...review, ...priority].filter((r) => !seen.has(r.evidenceId) && seen.add(r.evidenceId)));

      await loadTeams(mine);

      // The roster picker (M25): active users, admin-or-lead-visible.
      try { setDirectory(await client.listUserDirectory()); } catch { setDirectory([]); }

      // Recent team activity: merge the per-case feeds, newest first.
      const feeds = await Promise.all(mine.slice(0, 10).map(async (c) => {
        try {
          const feed = await client.getCaseActivity(c.id, 10);
          return feed.map((e) => ({ ...e, caseId: c.id, caseName: c.name }));
        } catch {
          return [];
        }
      }));
      setActivity(feeds.flat().sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 20));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const addMember = () =>
    teamErr.run(async () => {
      if (!addingTo) return;
      await client.addParticipant(addingTo.caseId, pUser, pRole);
      setAddingTo(null);
      setPUser('');
      await loadTeams(leadCases);
    });

  // Candidates: active users not yet on the roster; the case-lead role can
  // only be granted to users holding the global lead role (server-enforced —
  // the picker just avoids offering a guaranteed 400).
  const candidates = addingTo
    ? directory.filter((u) =>
        !addingTo.participants.some((p) => p.userId === u.username)
        && (pRole !== 'lead' || u.role === 'lead'))
    : [];

  const removeMember = (caseId: string, userId: string) =>
    teamErr.run(async () => {
      await client.removeParticipant(caseId, userId);
      await loadTeams(leadCases);
    });

  const changeMemberRole = (caseId: string, userId: string, roleInCase: CaseRole) =>
    teamErr.run(async () => {
      await client.updateParticipantRole(caseId, userId, roleInCase);
      await loadTeams(leadCases);
    });

  return (
    <div className="demo">
      <section className="col">
        <div className="card">
          <h3>My cases ({leadCases.length})</h3>
          {leadCases.length === 0 ? <p className="muted">You lead no cases yet.</p> : (
            <ul className="plain-list">
              {leadCases.map((c) => (
                <li key={c.id}>
                  <span>
                    <Link to={`/cases/${encodeURIComponent(c.id)}`}>{c.name}</Link>{' '}
                    <StatusPill status={c.status} />
                  </span>
                  <Link className="small" to={`/cases/${encodeURIComponent(c.id)}/report`}>CoC report</Link>
                </li>
              ))}
            </ul>
          )}
          {msg && <div className="err">{msg}</div>}
        </div>
        <div className="card">
          <h3>My team</h3>
          {teams.length === 0 ? <p className="muted">No led cases — no roster to manage.</p> : teams.map((team) => (
            <div key={team.caseId}>
              <div className="row-between">
                <h4><Link to={`/cases/${encodeURIComponent(team.caseId)}`}>{team.caseName}</Link></h4>
                <button className="small" onClick={() => { setAddingTo(team); setPUser(''); setPRole('viewer'); }}>Add member</button>
              </div>
              <ul className="plain-list">
                {team.participants.map((p) => (
                  <li key={p.userId}>
                    <span>
                      {p.userId}{' '}
                      <Badge tone={p.roleInCase === 'lead' ? 'warn' : 'muted'}>{CASE_ROLE_LABELS[p.roleInCase]}</Badge>
                    </span>
                    <span className="btn-row">
                      <select
                        value={p.roleInCase}
                        aria-label={`role of ${p.userId} in ${team.caseName}`}
                        onChange={(e) => changeMemberRole(team.caseId, p.userId, e.target.value as CaseRole)}
                      >
                        {ALL_CASE_ROLES.map((r) => <option key={r} value={r}>{CASE_ROLE_LABELS[r]}</option>)}
                      </select>
                      <button className="small" onClick={() => removeMember(team.caseId, p.userId)}>Remove</button>
                    </span>
                  </li>
                ))}
                {team.participants.length === 0 && <li className="muted small">No participants yet.</li>}
              </ul>
            </div>
          ))}
          <p className="hint">A case keeps at least one lead; removals are server-checked.</p>
          {teamErr.msg && <div className="err">{teamErr.msg}</div>}
        </div>
        <div className="card">
          <h3>Flagged evidence ({flagged.length})</h3>
          {flagged.length === 0 ? <p className="muted">Nothing awaiting review.</p> : (
            <ul className="plain-list">
              {flagged.map((r) => (
                <li key={r.evidenceId}>
                  <span>
                    <Link className="mono small" to={`/evidence/${encodeURIComponent(r.evidenceId)}`}>{r.label ?? r.evidenceId}</Link>
                  </span>
                  <Badge tone={r.flag === 'HIGH_PRIORITY' ? 'danger' : 'warn'}>
                    {r.flag === 'HIGH_PRIORITY' ? 'High priority' : 'Needs review'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className="col wide">
        <div className="card">
          <h3>Recent team activity</h3>
          {activity.length === 0 ? <p className="muted">No recent activity.</p> : (
            <Timeline
              items={activity.map((e, i) => ({
                key: `${e.caseId}-${e.id ?? e.ts}-${i}`,
                tone: activityTone(e),
                content: (
                  <div className="tl-row">
                    <span className="small">{e.caseName}</span>
                    <span>{activityLine(e)}</span>
                    <span className="ts small muted" title={e.ts}>{formatTs(e.ts)}</span>
                  </div>
                ),
              }))}
            />
          )}
        </div>
      </section>

      {addingTo && (
        <Modal title={`Add member — ${addingTo.caseName}`} onClose={() => setAddingTo(null)}>
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
              <button disabled={!pUser} onClick={addMember}>Grant access</button>
              <button className="small" onClick={() => setAddingTo(null)}>Cancel</button>
            </div>
            {teamErr.msg && <div className="err">{teamErr.msg}</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
