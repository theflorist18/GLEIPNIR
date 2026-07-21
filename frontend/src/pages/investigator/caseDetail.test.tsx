import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail, User } from '../../types';

// Light render tests (M23): the page is driven by a mocked GatewayClient via
// a mocked useAuth — no network, no real AuthProvider.
const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: mockUseAuth }));

import { CaseDetailPage, evidenceCsv } from './CaseDetailPage';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const DETAIL: CaseDetail = {
  id: 'CASE-1111', name: 'Op Nightjar', description: 'test', status: 'OPEN',
  createdBy: 'lena', createdAt: '2026-07-17T00:00:00Z', updatedAt: '2026-07-17T00:00:00Z',
  participants: [
    { userId: 'lena', roleInCase: 'lead' },
    { userId: 'ivy', roleInCase: 'contributor' },
  ],
  evidence: [{
    evidenceId: 'ev-1', caseId: 'CASE-1111', originalFilename: 'disk.img', mimeType: 'application/octet-stream',
    sizeBytes: 42, integrityProof: 'ni:///sha-256;x', uploadedBy: 'ivy', uploadedAt: '2026-07-17T01:00:00Z',
    status: 'ACTIVE', lastSyncedAt: null, label: 'ITEM-001', categoryId: 'cat-1', flag: 'HIGH_PRIORITY',
  }],
  categories: [{ id: 'cat-1', caseId: 'CASE-1111', name: 'Disk Images', createdBy: 'lena', createdAt: '2026-07-17T00:00:00Z' }],
};

function renderAs(user: Partial<User>) {
  const client = {
    getCase: vi.fn().mockResolvedValue(DETAIL),
    getCaseActivity: vi.fn().mockResolvedValue([]),
    addParticipant: vi.fn(),
    removeParticipant: vi.fn(),
  };
  mockUseAuth.mockReturnValue({ client, user: { id: 'u', active: true, name: '', ...user } });
  render(
    <MemoryRouter initialEntries={['/cases/CASE-1111']}>
      <Routes><Route path="/cases/:caseId" element={<CaseDetailPage />} /></Routes>
    </MemoryRouter>,
  );
  return client;
}

describe('CaseDetailPage (M23 tabs; M25 overview sections)', () => {
  it('M25: Team lives on Overview — the lead expands it and gets management controls', async () => {
    renderAs({ username: 'lena', role: 'lead' });
    await waitFor(() => expect(screen.getByText('Op Nightjar')).toBeTruthy());
    // No Team tab any more; the tab strip is Overview/Evidence/Activity.
    expect(screen.queryByRole('tab', { name: /Team/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /Evidence \(1\)/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Team \(2\)/ }));
    expect(screen.getByText('Add participant')).toBeTruthy();
    expect(screen.getByLabelText('role of ivy')).toBeTruthy();
    expect(screen.getAllByText('Remove').length).toBe(2);
  });

  it('M25: a contributor sees the Team roster read-only (no management controls)', async () => {
    renderAs({ username: 'ivy', role: 'investigator' });
    await waitFor(() => expect(screen.getByText('Op Nightjar')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Team \(2\)/ }));
    expect(screen.getByText('lena')).toBeTruthy();
    expect(screen.queryByText('Add participant')).toBeNull();
    expect(screen.queryByText('Remove')).toBeNull();
    expect(screen.queryByLabelText('role of lena')).toBeNull();
  });

  it('M25: Categories are collapsed until pressed, then the list shows', async () => {
    renderAs({ username: 'root', role: 'admin' });
    await waitFor(() => expect(screen.getByText('Op Nightjar')).toBeTruthy());
    expect(screen.queryByText('Disk Images')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Categories \(1\)/ }));
    expect(screen.getByText('Disk Images')).toBeTruthy();
  });

  it('M25: evidence filters narrow the table and drive the CSV export count', async () => {
    renderAs({ username: 'root', role: 'admin' });
    await waitFor(() => expect(screen.getByText('Op Nightjar')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: /Evidence \(1\)/ }));
    expect(screen.getByText('ev-1')).toBeTruthy();
    expect(screen.getByText('Export CSV (1)')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('filter: id, item, filename'), { target: { value: 'no-such' } });
    expect(screen.queryByText('ev-1')).toBeNull();
    expect(screen.getByText('No evidence matches the filters.')).toBeTruthy();
    expect((screen.getByText('Export CSV (0)') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('evidenceCsv (M25)', () => {
  it('emits a header + one quoted-when-needed row per filtered item', () => {
    const csv = evidenceCsv(DETAIL.evidence, () => 'Disk, Images');
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('item,evidenceId,file,category,flag,sizeBytes,uploadedBy,uploadedAt,status,integrityProof');
    expect(lines[1]).toContain('ITEM-001,ev-1,disk.img,"Disk, Images",HIGH_PRIORITY,42,ivy');
    expect(lines.length).toBe(2);
  });

  it('doubles embedded quotes and empties nulls', () => {
    const rows = [{ ...DETAIL.evidence[0], label: 'say "hi"', originalFilename: null }];
    const line = evidenceCsv(rows, () => null).trimEnd().split('\r\n')[1];
    expect(line.startsWith('"say ""hi""",ev-1,,,')).toBe(true);
  });
});
