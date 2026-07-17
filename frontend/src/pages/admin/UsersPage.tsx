import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useErr } from '../../hooks/useErr';
import { ALL_ROLES, ROLE_LABELS } from '../../roles';
import { Badge } from '../../components/ui/Badge';
import type { BadgeTone } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import type { Role, User } from '../../types';

const ROLE_TONE: Record<Role, BadgeTone> = { admin: 'accent', lead: 'warn', investigator: 'muted' };

// User administration (M14, admin-only route; M21 modal refresh). Users are
// deactivated, never deleted — audit-trail actors must keep resolving to a
// real username.
export function UsersPage() {
  const { client, user: me } = useAuth();
  const listErr = useErr();
  const editErr = useErr();
  const [users, setUsers] = useState<User[]>([]);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('investigator');

  const [editRole, setEditRole] = useState<Role>('investigator');
  const [newPassword, setNewPassword] = useState('');

  const refresh = useCallback(
    () => listErr.run(async () => setUsers(await client.listUsers())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  );
  useEffect(() => { void refresh(); }, [refresh]);

  const openCreate = () => {
    setUsername(''); setPassword(''); setName(''); setRole('investigator');
    setCreating(true);
  };

  const openEdit = (u: User) => {
    setSelected(u);
    setEditRole(u.role);
    setNewPassword('');
  };

  const create = () =>
    listErr.run(async () => {
      await client.createUser({ username, password, name: name || undefined, role });
      setCreating(false);
      await refresh();
    });

  const patch = (u: User, p: { role?: Role; active?: boolean }) =>
    editErr.run(async () => {
      const updated = await client.updateUser(u.id, p);
      setSelected(updated);
      await refresh();
    });

  const resetPw = () =>
    editErr.run(async () => {
      if (!selected) return;
      await client.resetPassword(selected.id, newPassword);
      setNewPassword('');
    });

  return (
    <div>
      <div className="card">
        <div className="evidence-head">
          <h3>Users ({users.length})</h3>
          <button onClick={openCreate}>New user</button>
        </div>
        {listErr.msg && <div className="err">{listErr.msg}</div>}
        <table className="runs">
          <thead><tr><th>username</th><th>name</th><th>role</th><th>active</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => openEdit(u)}>
                <td className="mono small">{u.username}</td>
                <td>{u.name}</td>
                <td><Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge></td>
                <td><span className={`pill ${u.active ? 'active' : 'removed'}`}>{u.active ? 'active' : 'inactive'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">Deactivate rather than delete: on-chain audit actors must keep resolving.</p>
      </div>

      {creating && (
        <Modal title="Create user" onClose={() => setCreating(false)}>
          <div className="form">
            <label>username<input value={username} onChange={(e) => setUsername(e.target.value)} /></label>
            <label>password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <label>name<input value={name} placeholder="defaults to username" onChange={(e) => setName(e.target.value)} /></label>
            <label>role
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </label>
            <div className="btn-row">
              <button disabled={!username || !password} onClick={create}>Create</button>
              <button className="small" onClick={() => setCreating(false)}>Cancel</button>
            </div>
            {listErr.msg && <div className="err">{listErr.msg}</div>}
          </div>
        </Modal>
      )}

      {selected && (
        <Modal title={`Edit: ${selected.username}`} onClose={() => setSelected(null)}>
          <div className="form">
            <div className="kv-line">
              <span className="muted small">current role</span>{' '}
              <Badge tone={ROLE_TONE[selected.role]}>{ROLE_LABELS[selected.role]}</Badge>
            </div>
            <label>assign role
              <select value={editRole} onChange={(e) => setEditRole(e.target.value as Role)} disabled={selected.username === me?.username}>
                {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </label>
            <div className="btn-row">
              <button
                disabled={selected.username === me?.username || editRole === selected.role}
                onClick={() => patch(selected, { role: editRole })}
              >
                Apply role
              </button>
              <button
                onClick={() => patch(selected, { active: !selected.active })}
                disabled={selected.username === me?.username}
              >
                {selected.active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
            <label>new password<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label>
            <button disabled={!newPassword} onClick={resetPw}>Reset password</button>
            {editErr.msg && <div className="err">{editErr.msg}</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
