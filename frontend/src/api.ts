// Typed client for the gateway public API (docs/CONTRACTS.md §6).
//
// Base URL is `/api/v1` (proxied to gateway:3000 by nginx in prod and by the
// Vite dev server in dev — both preserve the path). Auth is a static bearer
// token (default `dev-token`, documented non-production).
//
// This module is the ONLY place the SPA reaches the network. The frontend never
// talks to Fabric directly — everything goes through the gateway BFF.

import type {
  AccessLogRequest,
  CoCEvent,
  CreateEvidenceRequest,
  EvidenceRecord,
  RunDetail,
  RunRequest,
  TransferCustodyRequest,
  VerifyResult,
} from './types';

const DEFAULT_BASE = '/api/v1';

export interface GatewayClientOptions {
  getToken: () => string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
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

  constructor(opts: GatewayClientOptions) {
    this.getToken = opts.getToken;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  url(path: string): string {
    return this.baseUrl + path;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.getToken()}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await this.fetchImpl(this.url(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) throw new GatewayError(res.status, text);
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

  async getEvidence(id: string): Promise<EvidenceRecord> {
    const raw = await this.request<unknown>('GET', `/evidence/${encodeURIComponent(id)}`);
    return normalizeRecord(raw);
  }

  async getAudit(id: string): Promise<CoCEvent[]> {
    const raw = await this.request<unknown>('GET', `/evidence/${encodeURIComponent(id)}/audit`);
    return normalizeEvents(raw);
  }

  verifyEvidence(id: string): Promise<VerifyResult> {
    return this.request<VerifyResult>('GET', `/evidence/${encodeURIComponent(id)}/verify`);
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
}
