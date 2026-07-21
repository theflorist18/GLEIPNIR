// Typed client for the gateway public API (docs/CONTRACTS.md §6).
//
// Base URL is `/api/v1` (proxied to gateway:3000 by nginx in prod and by the
// Vite dev server in dev — both preserve the path). Auth (M14): an opaque
// session token from POST /auth/login, held by AuthContext; `onUnauthorized`
// fires on any 401 so the app can drop a dead session and route to /login.
//
// This module is the ONLY place the SPA reaches the network. The frontend never
// talks to Fabric directly — everything goes through the gateway BFF.

import type {
  AccessLogRequest,
  CaseActivityEvent,
  CaseDetail,
  CaseParticipant,
  CaseRole,
  CaseStatus,
  CaseSummary,
  CoCEvent,
  CocReport,
  CreateEvidenceRequest,
  EvidenceCategory,
  EvidenceDetailsPatch,
  EvidenceFlag,
  EvidenceIndexRow,
  EvidenceNote,
  EvidenceRecord,
  EvidenceSearchParams,
  ExportBundle,
  Role,
  RunDetail,
  RunRequest,
  TransferCustodyRequest,
  UploadResult,
  User,
  VerifyResult,
} from './types';

const DEFAULT_BASE = '/api/v1';

export interface GatewayClientOptions {
  getToken: () => string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  onUnauthorized?: () => void;
}

export class GatewayError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `Gateway request failed (${status})`);
    this.name = 'GatewayError';
    this.status = status;
    this.body = body;
  }
}

function parseMaybe(raw: unknown): unknown {
  // Chaincode reads return JSON strings; the gateway may forward them as-is.
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function normalizeRecord(raw: unknown): EvidenceRecord {
  const v = parseMaybe(raw) as Record<string, unknown> | null;
  if (v && typeof v === 'object' && 'record' in v && v.record) {
    return parseMaybe(v.record) as EvidenceRecord;
  }
  return (v ?? {}) as EvidenceRecord;
}

function normalizeEvents(raw: unknown): CoCEvent[] {
  const v = parseMaybe(raw) as unknown;
  if (Array.isArray(v)) return v as CoCEvent[];
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (Array.isArray(obj.events)) return obj.events as CoCEvent[];
    if (Array.isArray(obj.audit)) return obj.audit as CoCEvent[];
  }
  return [];
}

function normalizeRuns(raw: unknown): RunDetail[] {
  const v = parseMaybe(raw) as unknown;
  if (Array.isArray(v)) return v as RunDetail[];
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (Array.isArray(obj.runs)) return obj.runs as RunDetail[];
  }
  return [];
}

export class GatewayClient {
  private getToken: () => string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private onUnauthorized?: () => void;

  constructor(opts: GatewayClientOptions) {
    this.getToken = opts.getToken;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.onUnauthorized = opts.onUnauthorized;
  }

  url(path: string): string {
    return this.baseUrl + path;
  }

  private authHeaders(): Record<string, string> {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private failed(res: Response, text: string): GatewayError {
    if (res.status === 401 && this.onUnauthorized) this.onUnauthorized();
    return new GatewayError(res.status, text);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = this.authHeaders();
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await this.fetchImpl(this.url(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) throw this.failed(res, text);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  // ---- Scope B: chain of custody ----

  createEvidence(req: CreateEvidenceRequest) {
    return this.request<{ evidenceId?: string; txId?: string } & Record<string, unknown>>(
      'POST',
      '/evidence',
      req,
    );
  }

  transferCustody(id: string, req: TransferCustodyRequest) {
    return this.request<Record<string, unknown>>(
      'POST',
      `/evidence/${encodeURIComponent(id)}/transfer`,
      req,
    );
  }

  accessLog(id: string, req: AccessLogRequest) {
    return this.request<Record<string, unknown>>(
      'POST',
      `/evidence/${encodeURIComponent(id)}/access`,
      req,
    );
  }

  removeEvidence(id: string, reason: string) {
    return this.request<Record<string, unknown>>('DELETE', `/evidence/${encodeURIComponent(id)}`, {
      reason,
    });
  }

  // caseId routes reads to the right case channel in parallel variants (F68);
  // the gateway 400s parallel reads without it.
  async getEvidence(id: string, caseId?: string): Promise<EvidenceRecord> {
    const q = caseId ? `?caseId=${encodeURIComponent(caseId)}` : '';
    const raw = await this.request<unknown>('GET', `/evidence/${encodeURIComponent(id)}${q}`);
    return normalizeRecord(raw);
  }

  async getAudit(id: string, caseId?: string): Promise<CoCEvent[]> {
    const q = caseId ? `?caseId=${encodeURIComponent(caseId)}` : '';
    const raw = await this.request<unknown>('GET', `/evidence/${encodeURIComponent(id)}/audit${q}`);
    return normalizeEvents(raw);
  }

  // The verify chain is keyed by EVENT id, not evidence id (F33/F49): the
  // receipt store holds one witness per event. eventId comes from a write
  // response (every variant returns it).
  verifyEvidence(id: string, eventId: string): Promise<VerifyResult> {
    return this.request<VerifyResult>(
      'GET',
      `/evidence/${encodeURIComponent(id)}/verify?eventId=${encodeURIComponent(eventId)}`,
    );
  }

  // ---- Scope A: runs ----

  startRun(req: RunRequest): Promise<RunDetail> {
    return this.request<RunDetail>('POST', '/runs', req);
  }

  async listRuns(): Promise<RunDetail[]> {
    const raw = await this.request<unknown>('GET', '/runs');
    return normalizeRuns(raw);
  }

  getRun(id: string): Promise<RunDetail> {
    return this.request<RunDetail>('GET', `/runs/${encodeURIComponent(id)}`);
  }

  // ---- Auth & users (M14) ----

  login(username: string, password: string): Promise<{ token: string; user: User }> {
    return this.request<{ token: string; user: User }>('POST', '/auth/login', { username, password });
  }

  logout(): Promise<void> {
    return this.request<void>('POST', '/auth/logout');
  }

  me(): Promise<User> {
    return this.request<User>('GET', '/auth/me');
  }

  listUsers(): Promise<User[]> {
    return this.request<User[]>('GET', '/admin/users');
  }

  createUser(req: { username: string; password: string; name?: string; role?: Role }): Promise<User> {
    return this.request<User>('POST', '/admin/users', req);
  }

  updateUser(id: string, patch: { name?: string; role?: Role; active?: boolean }): Promise<User> {
    return this.request<User>('PATCH', `/admin/users/${encodeURIComponent(id)}`, patch);
  }

  resetPassword(id: string, password: string): Promise<User> {
    return this.request<User>('POST', `/admin/users/${encodeURIComponent(id)}/reset-password`, { password });
  }

  /** M25: read-only roster picker (active users) — admin or lead sessions only. */
  listUserDirectory(): Promise<User[]> {
    return this.request<User[]>('GET', '/users/directory');
  }

  // ---- Cases (M14; proxied to case-registry, scoped server-side) ----

  listCases(params?: { q?: string; status?: CaseStatus }): Promise<CaseSummary[]> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.status) qs.set('status', params.status);
    const suffix = qs.size > 0 ? `?${qs}` : '';
    return this.request<CaseSummary[]>('GET', `/cases${suffix}`);
  }

  searchCases(q: string, status?: CaseStatus): Promise<CaseSummary[]> {
    const qs = new URLSearchParams({ q });
    if (status) qs.set('status', status);
    return this.request<CaseSummary[]>('GET', `/cases/search?${qs}`);
  }

  getCase(id: string): Promise<CaseDetail> {
    return this.request<CaseDetail>('GET', `/cases/${encodeURIComponent(id)}`);
  }

  createCase(req: { name: string; description?: string; leadUserId?: string }): Promise<CaseSummary> {
    return this.request<CaseSummary>('POST', '/cases', req);
  }

  updateCase(id: string, patch: { name?: string; description?: string; status?: CaseStatus }): Promise<CaseSummary> {
    return this.request<CaseSummary>('PATCH', `/cases/${encodeURIComponent(id)}`, patch);
  }

  addParticipant(caseId: string, userId: string, roleInCase: CaseRole): Promise<unknown> {
    return this.request('POST', `/cases/${encodeURIComponent(caseId)}/participants`, { userId, roleInCase });
  }

  removeParticipant(caseId: string, userId: string): Promise<void> {
    return this.request<void>('DELETE', `/cases/${encodeURIComponent(caseId)}/participants/${encodeURIComponent(userId)}`);
  }

  /** M25: change a participant's case role in place (admin-or-case-lead). */
  updateParticipantRole(caseId: string, userId: string, roleInCase: CaseRole): Promise<CaseParticipant> {
    return this.request<CaseParticipant>('PATCH', `/cases/${encodeURIComponent(caseId)}/participants/${encodeURIComponent(userId)}`, { roleInCase });
  }

  // ---- evidence categories (M19): per-case taxonomy, lead-managed ----
  listCategories(caseId: string): Promise<EvidenceCategory[]> {
    return this.request<EvidenceCategory[]>('GET', `/cases/${encodeURIComponent(caseId)}/categories`);
  }

  createCategory(caseId: string, name: string): Promise<EvidenceCategory> {
    return this.request<EvidenceCategory>('POST', `/cases/${encodeURIComponent(caseId)}/categories`, { name });
  }

  renameCategory(caseId: string, categoryId: string, name: string): Promise<EvidenceCategory> {
    return this.request<EvidenceCategory>('PATCH', `/cases/${encodeURIComponent(caseId)}/categories/${encodeURIComponent(categoryId)}`, { name });
  }

  deleteCategory(caseId: string, categoryId: string): Promise<void> {
    return this.request<void>('DELETE', `/cases/${encodeURIComponent(caseId)}/categories/${encodeURIComponent(categoryId)}`);
  }

  updateEvidenceDetails(evidenceId: string, patch: EvidenceDetailsPatch): Promise<EvidenceIndexRow> {
    return this.request<EvidenceIndexRow>('PATCH', `/evidence/${encodeURIComponent(evidenceId)}/details`, patch);
  }

  assignEvidence(caseId: string, evidenceId: string): Promise<EvidenceIndexRow> {
    return this.request<EvidenceIndexRow>('POST', `/cases/${encodeURIComponent(caseId)}/evidence`, { evidenceId });
  }

  unassignEvidence(caseId: string, evidenceId: string): Promise<void> {
    return this.request<void>('DELETE', `/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(evidenceId)}`);
  }

  // ---- Evidence library (M14) ----

  // Real file ingest: multipart POST — bytes go to the evidence-store; only
  // the ni-URI proof reaches the chain. Content-Type is left to the browser
  // (multipart boundary).
  async uploadEvidence(form: FormData): Promise<UploadResult> {
    const res = await this.fetchImpl(this.url('/evidence'), {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });
    const text = await res.text();
    if (!res.ok) throw this.failed(res, text);
    return JSON.parse(text) as UploadResult;
  }

  searchEvidence(params: EvidenceSearchParams): Promise<EvidenceIndexRow[]> {
    const qs = new URLSearchParams();
    for (const k of ['q', 'flag', 'caseId', 'uploadedBy', 'type', 'from', 'to'] as const) {
      const v = params[k];
      if (v) qs.set(k, v);
    }
    return this.request<EvidenceIndexRow[]>('GET', `/evidence/search?${qs}`);
  }

  // ---- collaboration (M20): examiner notes, flag, case activity ----
  listNotes(evidenceId: string): Promise<EvidenceNote[]> {
    return this.request<EvidenceNote[]>('GET', `/evidence/${encodeURIComponent(evidenceId)}/notes`);
  }

  /** Append-only: there is no edit or delete — notes are immutable by API. */
  addNote(evidenceId: string, body: string): Promise<EvidenceNote> {
    return this.request<EvidenceNote>('POST', `/evidence/${encodeURIComponent(evidenceId)}/notes`, { body });
  }

  setFlag(evidenceId: string, flag: EvidenceFlag): Promise<EvidenceIndexRow> {
    return this.request<EvidenceIndexRow>('PUT', `/evidence/${encodeURIComponent(evidenceId)}/flag`, { flag });
  }

  getCaseActivity(caseId: string, limit?: number): Promise<CaseActivityEvent[]> {
    const qs = limit ? `?limit=${limit}` : '';
    return this.request<CaseActivityEvent[]>('GET', `/cases/${encodeURIComponent(caseId)}/activity${qs}`);
  }

  // ---- per-case CoC report (M24). Fetching it auto-logs one ACCESS per
  // included evidence under the session username (server-side, synchronous).
  getCocReport(caseId: string): Promise<CocReport> {
    return this.request<CocReport>('GET', `/cases/${encodeURIComponent(caseId)}/coc-report`);
  }

  async downloadCocReportCsv(caseId: string): Promise<{ blob: Blob; filename: string }> {
    const res = await this.fetchImpl(this.url(`/cases/${encodeURIComponent(caseId)}/coc-report?format=csv`), {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw this.failed(res, await res.text());
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]*)"/.exec(disposition);
    return { blob: await res.blob(), filename: match?.[1] || `coc-${caseId}.csv` };
  }

  // Streams the blob back; the caller turns it into a browser download.
  // Server-side this appends a synchronous AccessLog(download) event.
  async downloadEvidence(id: string): Promise<{ blob: Blob; filename: string }> {
    const res = await this.fetchImpl(this.url(`/evidence/${encodeURIComponent(id)}/download`), {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw this.failed(res, await res.text());
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]*)"/.exec(disposition);
    return { blob: await res.blob(), filename: match?.[1] || `${id}.bin` };
  }

  exportEvidence(id: string): Promise<ExportBundle> {
    return this.request<ExportBundle>('GET', `/evidence/${encodeURIComponent(id)}/export`);
  }
}
