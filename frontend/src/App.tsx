import { useState } from 'react';
import { useSettings } from './settings';
import { Demo } from './demo';
import { Dashboard } from './dashboard';

type Scope = 'demo' | 'dashboard';

// One app, two scopes (ARCHITECTURE §5): the CoC demo (Scope B) and the operator
// dashboard (Scope A). A simple top-level switch selects between them.
export function App() {
  const [scope, setScope] = useState<Scope>('demo');
  const { token, setToken } = useSettings();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">GLEIPNIR</div>
        <nav className="scopes">
          <button className={scope === 'demo' ? 'active' : ''} onClick={() => setScope('demo')}>
            Chain-of-Custody Demo
          </button>
          <button className={scope === 'dashboard' ? 'active' : ''} onClick={() => setScope('dashboard')}>
            Operator Dashboard
          </button>
        </nav>
        <label className="token">
          token
          <input value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
      </header>
      <main className="content">{scope === 'demo' ? <Demo /> : <Dashboard />}</main>
      <footer className="foot">
        Talks only to the API gateway · Hyperledger Fabric 2.5 LTS · localhost thesis demo
      </footer>
    </div>
  );
}
