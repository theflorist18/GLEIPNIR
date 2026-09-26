import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useErr } from '../../hooks/useErr';
import { activityLine, activityTone } from '../../lib/activity';
import { formatTs } from '../../lib/format';
import { Badge } from '../../components/ui/Badge';
import { Timeline } from '../../components/ui/Timeline';
import { AddMemberModal, RosterList } from '../../components/TeamRoster';
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

  const addMember = (userId: string, roleInCase: CaseRole) =>
    teamErr.run(async () => {
      if (!addingTo) return;
      await client.addParticipant(addingTo.caseId, userId, roleInCase);
      setAddingTo(null);
      await loadTeams(leadCases);
    });

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
                <button className="small" onClick={() => setAddingTo(team)}>Add member</button>
              </div>
              <RosterList
                participants={team.participants}
                manage
                label={(u) => `role of ${u} in ${team.caseName}`}
                onRole={(u, r) => changeMemberRole(team.caseId, u, r)}
                onRemove={(u) => removeMember(team.caseId, u)}
              />
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
        <AddMemberModal
          title={`Add member — ${addingTo.caseName}`}
          roster={addingTo.participants}
          directory={directory}
          onAdd={addMember}
          onClose={() => setAddingTo(null)}
          err={teamErr.msg}
        />
      )}
    </div>
  );
}
