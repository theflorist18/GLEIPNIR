import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useErr } from '../../hooks/useErr';
import type { Role, User } from '../../types';

// User administration (M14, admin-only route). Users are deactivated, never
// deleted — audit-trail actors must keep resolving to a real username.
export function UsersPage() {
  const { client, user: me } = useAuth();
  const listErr = useErr();
  const editErr = useErr();
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<User | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('investigator');

  const [newPassword, setNewPassword] = useState('');

  const refresh = useCallback(
    () => listErr.run(async () => setUsers(await client.listUsers())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  );
  useEffect(() => { void refresh(); }, [refresh]);

  const create = () =>
    listErr.run(async () => {
      await client.createUser({ username, password, name: name || undefined, role });
      setUsername(''); setPassword(''); setName('');
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
    <div className="demo">
      <section className="col">
        <div className="card form">
          <h3>Create user</h3>
          <label>username<input value={username} onChange={(e) => setUsername(e.target.value)} /></label>
          <label>password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label>name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>role
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="investigator">investigator</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button disabled={!username || !password} onClick={create}>Create</button>
          {listErr.msg && <div className="err">{listErr.msg}</div>}
        </div>
        {selected && (
          <div className="card form">
            <h3>Edit: {selected.username}</h3>
            <div className="btn-row">
              <button
                onClick={() => patch(selected, { role: selected.role === 'admin' ? 'investigator' : 'admin' })}
                disabled={selected.username === me?.username}
              >
                Make {selected.role === 'admin' ? 'investigator' : 'admin'}
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
        )}
      </section>
      <section className="col wide">
        <div className="card">
          <h3>Users ({users.length})</h3>
          <table className="runs">
            <thead><tr><th>username</th><th>name</th><th>role</th><th>active</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => { setSelected(u); setNewPassword(''); }}>
                  <td className="mono small">{u.username}</td>
                  <td>{u.name}</td>
                  <td>{u.role}</td>
                  <td><span className={`pill ${u.active ? 'active' : 'removed'}`}>{u.active ? 'active' : 'inactive'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Deactivate rather than delete: past audit events must keep resolving to a real user.</p>
        </div>
      </section>
    </div>
  );
}
