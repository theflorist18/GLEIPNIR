import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CaseDetail, CoCEvent, EvidenceIndexRow, EvidenceRecord, User } from '../../types';

// Render tests for the audit-logging behaviour of the evidence page, driven by
// a mocked GatewayClient — no network, no real providers.
const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: mockUseAuth }));

import { EvidenceDetailPage } from './EvidenceDetailPage';

beforeAll(() => {
  // jsdom has no object-URL support; the download path only needs it to exist.
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const RECORD: EvidenceRecord = {
  evidenceId: 'ev-1', caseId: 'CASE-1111', integrityProof: 'ni:///sha-256;x',
  custodian: 'ivy', createdAt: '2026-07-17T01:00:00Z', status: 'ACTIVE',
} as unknown as EvidenceRecord;

const TRAIL: CoCEvent[] = [
  { evidenceId: 'ev-1', op: 'CREATE', actor: 'ivy', ts: '2026-07-17T01:00:00Z' } as unknown as CoCEvent,
];

const ROW: EvidenceIndexRow = {
  evidenceId: 'ev-1', caseId: 'CASE-1111', originalFilename: 'disk.img',
  mimeType: 'application/octet-stream', sizeBytes: 42, integrityProof: 'ni:///sha-256;x',
  uploadedBy: 'ivy', uploadedAt: '2026-07-17T01:00:00Z', status: 'ACTIVE',
  lastSyncedAt: null, label: 'ITEM-001', categoryId: null, flag: null,
} as unknown as EvidenceIndexRow;

const CASE: CaseDetail = {
  id: 'CASE-1111', name: 'Op Nightjar', description: '', status: 'OPEN',
  createdBy: 'lena', createdAt: '2026-07-17T00:00:00Z', updatedAt: '2026-07-17T00:00:00Z',
  participants: [{ userId: 'ivy', roleInCase: 'contributor' }],
  evidence: [], categories: [],
} as unknown as CaseDetail;

function renderPage(user: Partial<User>) {
  const client = {
    getEvidence: vi.fn().mockResolvedValue(RECORD),
    getAudit: vi.fn().mockResolvedValue(TRAIL),
    searchEvidence: vi.fn().mockResolvedValue([ROW]),
    getCase: vi.fn().mockResolvedValue(CASE),
    listNotes: vi.fn().mockResolvedValue([]),
    downloadEvidence: vi.fn().mockResolvedValue({ blob: new Blob(['bytes']), filename: 'disk.img' }),
    exportEvidence: vi.fn().mockResolvedValue({ evidenceId: 'ev-1', record: RECORD, auditTrail: TRAIL }),
    accessLog: vi.fn(),
    verifyEvidence: vi.fn().mockResolvedValue({ ok: true }),
  };
  mockUseAuth.mockReturnValue({ client, user: { id: 'u', active: true, name: '', ...user } });
  render(
    <MemoryRouter initialEntries={['/evidence/ev-1']}>
      <Routes><Route path="/evidence/:evidenceId" element={<EvidenceDetailPage />} /></Routes>
    </MemoryRouter>,
  );
  return client;
}

describe('EvidenceDetailPage — the UI must not forge chain-of-custody events', () => {
  // Regression: doDownload/doExport used to call the full refresh(), whose
  // record read hits GET /evidence/:id — an endpoint that auto-appends
  // ACCESS('view'). Every download therefore landed on the chain as
  // "download + view", recording an access the examiner never performed.
  // The trail-only refresh shows the new event without creating another.
  it('a download refreshes the trail only — it does not re-read the record (which would log a view)', async () => {
    const client = renderPage({ username: 'ivy', role: 'investigator' });
    await waitFor(() => expect(client.getEvidence).toHaveBeenCalledTimes(1));
    expect(client.getAudit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(client.downloadEvidence).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(client.getAudit).toHaveBeenCalledTimes(2));
    // The decisive assertion: still exactly one record read (the initial view).
    expect(client.getEvidence).toHaveBeenCalledTimes(1);
  });

  it('an export refreshes the trail only — same rule', async () => {
    const client = renderPage({ username: 'ivy', role: 'investigator' });
    await waitFor(() => expect(client.getEvidence).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /^Export/ }));

    await waitFor(() => expect(client.exportEvidence).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(client.getAudit).toHaveBeenCalledTimes(2));
    expect(client.getEvidence).toHaveBeenCalledTimes(1);
  });
});

describe('EvidenceDetailPage — Merkle verify follows the per-event batched flag', () => {
  it('stays N/A after a direct write; a batched write enables Verify latest', async () => {
    const client = renderPage({ username: 'ivy', role: 'investigator' });
    fireEvent.click(await screen.findByRole('tab', { name: /Chain of custody/ }));
    const verifyBtn = () => screen.getByRole('button', { name: 'Verify latest' }) as HTMLButtonElement;

    // Direct variants answer 201 {txId, eventId} — nothing to verify.
    client.accessLog.mockResolvedValueOnce({ txId: 'tx-1', eventId: 'evt-1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Log access' }));
    await screen.findByText('evt-1');
    expect(verifyBtn().disabled).toBe(true);
    expect(screen.getByText('Merkle: N/A')).toBeTruthy();

    // Anchored variants answer 202 {batched: true, eventId}.
    client.accessLog.mockResolvedValueOnce({ batched: true, eventId: 'evt-2' });
    fireEvent.click(screen.getByRole('button', { name: 'Log access' }));
    await waitFor(() => expect(verifyBtn().disabled).toBe(false));
    fireEvent.click(verifyBtn());
    await waitFor(() => expect(client.verifyEvidence).toHaveBeenCalledWith('ev-1', 'evt-2'));
    expect(await screen.findByText(/VERIFIED/)).toBeTruthy();
  });
});
