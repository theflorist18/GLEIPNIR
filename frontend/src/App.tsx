import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { LoginPage } from './auth/LoginPage';
import { TopBar } from './components/Layout/TopBar';
import { Sidebar } from './components/Layout/Sidebar';
import { IngestPage } from './pages/investigator/IngestPage';
import { MyCasesPage } from './pages/investigator/MyCasesPage';
import { CaseDetailPage } from './pages/investigator/CaseDetailPage';
import { CoCReportPage } from './pages/investigator/CoCReportPage';
import { EvidenceDetailPage } from './pages/investigator/EvidenceDetailPage';
import { SearchPage } from './pages/investigator/SearchPage';
import { LeadDashboardPage } from './pages/lead/LeadDashboardPage';
import { UsersPage } from './pages/admin/UsersPage';
import { CasesAdminPage } from './pages/admin/CasesAdminPage';
import { UnauthorizedPage } from './pages/shared/UnauthorizedPage';
import { NotFoundPage } from './pages/shared/NotFoundPage';

// Multi-page evidence library (M14). The old single-page demo scope toggle
// became real routes: the library pages for any signed-in role, the
// admin section RequireRole-gated. nginx's SPA fallback (try_files ->
// /index.html) makes deep links refresh-safe.

function Shell() {
  return (
    <div className="app">
      <TopBar />
      <div className="body">
        <Sidebar />
        <main className="content"><Outlet /></main>
      </div>
      <footer className="foot">
        Talks only to the API gateway · Hyperledger Fabric 2.5 LTS · localhost thesis demo
      </footer>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Print-optimized CoC report (M24): authenticated but OUTSIDE the
          shell — no nav chrome on the court document. */}
      <Route path="/cases/:caseId/report" element={<RequireAuth><CoCReportPage /></RequireAuth>} />
      <Route element={<RequireAuth><Shell /></RequireAuth>}>
        <Route index element={<Navigate to="/cases" replace />} />
        <Route path="/ingest" element={<IngestPage />} />
        <Route path="/cases" element={<MyCasesPage />} />
        <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        <Route path="/evidence/:evidenceId" element={<EvidenceDetailPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/lead/dashboard" element={<RequireRole roles={['lead', 'admin']}><LeadDashboardPage /></RequireRole>} />
        <Route path="/admin/users" element={<RequireRole roles={['admin']}><UsersPage /></RequireRole>} />
        <Route path="/admin/cases" element={<RequireRole roles={['admin']}><CasesAdminPage /></RequireRole>} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
