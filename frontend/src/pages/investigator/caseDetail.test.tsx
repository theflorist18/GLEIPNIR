import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail, User } from '../../types';

// Light render tests (M23): the page is driven by a mocked GatewayClient via
// a mocked useAuth — no network, no real AuthProvider.
const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: mockUseAuth }));

import { CaseDetailPage } from './CaseDetailPage';

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

describe('CaseDetailPage (M23 tabs)', () => {
  it('shows the Team tab to the case lead', async () => {
    renderAs({ username: 'lena', role: 'lead' });
    await waitFor(() => expect(screen.getByText('Op Nightjar')).toBeTruthy());
    expect(screen.getByRole('tab', { name: /Team \(2\)/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Evidence \(1\)/ })).toBeTruthy();
  });

  it('hides the Team tab from a contributor but keeps Overview/Evidence/Activity', async () => {
    renderAs({ username: 'ivy', role: 'investigator' });
    await waitFor(() => expect(screen.getByText('Op Nightjar')).toBeTruthy());
    expect(screen.queryByRole('tab', { name: /Team/ })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeTruthy();
  });

  it('shows the admin the Team tab and category chips on Overview', async () => {
    renderAs({ username: 'root', role: 'admin' });
    await waitFor(() => expect(screen.getByText('Op Nightjar')).toBeTruthy());
    expect(screen.getByRole('tab', { name: /Team/ })).toBeTruthy();
    expect(screen.getByText('Disk Images')).toBeTruthy();
  });
});
