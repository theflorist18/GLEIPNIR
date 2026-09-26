// Shared types for the GLEIPNIR SPA.
//
// The record/event shapes mirror docs/CONTRACTS.md §5 (Codex-Entry-inspired
// evidence head + CoC event).

export type Op = 'CREATE' | 'TRANSFER' | 'ACCESS' | 'DISPOSE';

// ---- Evidence head record (CONTRACTS §5, Codex-Entry mapping) ----

export interface StoragePointer {
  protocol?: string;
  location?: string;
  integrity_proof?: string; // RFC 6920 ni-URI; computed by the gateway (or client-side hash)
  jurisdiction?: string;
}

export interface IdentityInfo {
  org?: string;
  process?: string;
  artifact?: string;
  subject?: string;
}

export interface AnchorInfo {
  chain?: string;
  tx_hash?: string;
  hash_alg?: string;
}

export interface EvidenceRecord {
  id?: string;
  version?: string;
  storage?: StoragePointer;
  identity?: IdentityInfo;
  anchor?: AnchorInfo;
  previous_id?: string;
  custodian?: string;
  status?: string;
  caseId?: string;
}

// ---- CoC event (CONTRACTS §5) ----

export interface CoCEvent {
  eventId?: string;
  evidenceId?: string;
  caseId?: string;
  op?: Op;
  actor?: string;
  detail?: Record<string, unknown>;
  ts?: string;
}

// ---- Verification (gateway /evidence/:id/verify -> verification service) ----

export interface VerifyResult {
  ok: boolean;
  // 'root-mismatch' (tamper signal, HTTP 200), 'missing-receipt' /
  // 'missing-anchor-root' (404 — batch not yet closed / root not committed),
  // 'malformed-receipt' (422), or a transport-level reason.
  reason?: string;
  latencyMs?: number;
  steps?: { fetchMs?: number; recomputeMs?: number; compareRootMs?: number };
}

// ---- Request bodies ----

export interface TransferCustodyRequest {
  newCustodian: string;
  reason: string;
  actor?: string;
  caseId?: string; // required by the gateway in parallel variants (audit F68)
}

export interface AccessLogRequest {
  actor: string;
  action: string;
  caseId?: string; // required by the gateway in parallel variants (audit F68)
}

// ---- Evidence library (M14): auth, cases, evidence index ----
// Wire shapes pinned by docs/CONTRACTS.md (M12/M13 additions).

export type Role = 'admin' | 'lead' | 'investigator';

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type CaseStatus = 'OPEN' | 'CLOSED' | 'ARCHIVED';
export type CaseRole = 'viewer' | 'contributor' | 'lead';

export interface CaseParticipant {
  userId: string; // the immutable username
  roleInCase: CaseRole;
  addedBy?: string;
  addedAt?: string;
}

export interface CaseSummary {
  id: string; // CASE-<uuid> — never the parallel channel key case-NNN
  name: string;
  description: string;
  status: CaseStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** The caller's own case role — present only on participant-scoped listings (M18). */
  myRoleInCase?: CaseRole;
}

export interface CaseDetail extends CaseSummary {
  participants: CaseParticipant[];
  evidence: EvidenceIndexRow[];
  /** Per-case evidence taxonomy (M19), lead-managed. */
  categories?: EvidenceCategory[];
}

/** Per-case evidence category (M19) — off-chain taxonomy, lead-managed. */
export interface EvidenceCategory {
  id: string; // cat-<uuid>
  caseId: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

// Read-model row from case-registry — a cache; the ledger stays authoritative
// for status/custodian.
export interface EvidenceIndexRow {
  evidenceId: string;
  caseId: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  integrityProof: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  status: string;
  lastSyncedAt: string | null;
  // M19 forensic metadata — off-chain only, never on the chain record.
  label?: string | null;
  categoryId?: string | null;
  seizedAt?: string | null;
  acquisitionLocation?: string | null;
  handedOverBy?: string | null;
  /** M20 triage flag (single, or null). */
  flag?: EvidenceFlag;
}

/** M20: the one evidence triage flag (or null — unflagged). */
export type EvidenceFlag = 'HIGH_PRIORITY' | 'PROCESSED' | 'NEEDS_LEAD_REVIEW' | null;

/** M20: examiner note — append-only, immutable through the API. */
export interface EvidenceNote {
  id: string; // note-<uuid>
  evidenceId: string;
  author: string;
  body: string;
  createdAt: string;
}

/** M24: the per-case Chain-of-Custody report bundle (json format). */
export interface CocReport {
  caseId: string;
  name: string;
  description: string;
  status: CaseStatus;
  generatedAt: string;
  participants: CaseParticipant[];
  evidence: Array<EvidenceIndexRow & { category: string | null; auditTrail: CoCEvent[] }>;
}

/** One entry of the case activity feed (M20; persistent audit log since M25b). */
export interface CaseActivityEvent {
  /** Audit-log row id (evt-<uuid>). */
  id?: string;
  /** M25b event type (lib/activity.ts enumerates them). Render defensively: the enum can grow. */
  type: string;
  ts: string;
  actor?: string;
  evidenceId?: string;
  /** The acted-on entity: a userId for participant events, a categoryId for category events. */
  target?: string;
  detail?: Record<string, unknown>;
}

export interface UploadResult {
  evidenceId: string;
  eventId?: string;
  integrityProof: string;
  txId?: string;
  batched?: boolean;
}

export interface ExportBundle {
  evidenceId: string;
  exportedAt: string;
  record: EvidenceRecord | string;
  auditTrail: CoCEvent[] | string;
}

export interface EvidenceSearchParams {
  q?: string;
  flag?: Exclude<EvidenceFlag, null>;
  caseId?: string;
  uploadedBy?: string;
  type?: string;
  from?: string;
  to?: string;
}
