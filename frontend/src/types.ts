// Shared types for the GLEIPNIR SPA.
//
// The record/event shapes mirror docs/CONTRACTS.md §5 (Codex-Entry-inspired
// evidence head + CoC event). The run manifest / checkpoint shapes mirror
// docs/CONTRACTS.md §10/§11. CONTRACTS does not pin the exact field names the
// metrics collector (collect.py / regress.py) writes back into a run, so every
// metric field here is OPTIONAL and every consumer reads it defensively — a
// "requested but not yet executed" run legitimately has none of them.

export type Variant = 'standard' | 'anchoring' | 'parallel' | 'parallel-anchored';
export type Regime = 'smoke' | 'steady';
export type Op = 'CREATE' | 'TRANSFER' | 'ACCESS' | 'REMOVE';

// ---- Evidence head record (CONTRACTS §5, Codex-Entry mapping) ----

export interface StoragePointer {
  protocol?: string;
  location?: string;
  integrity_proof?: string; // RFC 6920 ni-URI; computed by the gateway (or client-side hash)
  jurisdiction?: string;
}

export interface EncryptionInfo {
  alg?: string;
  key_id?: string;
  last_controlled_by?: string;
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

export interface SignatureInfo {
  alg?: string;
  kid?: string;
  signature?: string;
}

export interface EvidenceRecord {
  id?: string;
  version?: string;
  storage?: StoragePointer;
  encryption?: EncryptionInfo;
  identity?: IdentityInfo;
  anchor?: AnchorInfo;
  signatures?: SignatureInfo[];
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

export interface CreateEvidenceRequest {
  evidenceId?: string; // gateway generates a UUIDv4 if omitted
  caseId?: string; // "shared" (standard/anchoring) or "case-00x" (parallel)
  version?: string;
  actor: string;
  storage: StoragePointer;
  identity?: IdentityInfo;
  encryption?: EncryptionInfo;
  previous_id?: string;
  // Optional: raw bytes for the gateway to hash into storage.integrity_proof.
  // Used ONLY for hashing, never for storage. Omitted when the client hashes locally.
  payloadBase64?: string;
}

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

// ---- Runs / sweep (CONTRACTS §10) ----

export interface SweepCell {
  N?: number;
  K?: number;
  channels?: number;
  offeredLoadTps?: number;
  repetition?: number;
}

export interface RunRequest {
  variant: Variant;
  regime: Regime;
  cell: SweepCell;
  repetitions?: number;
  notes?: string;
}

export interface LatencyStat {
  min?: number;
  avg?: number;
  max?: number;
}

export interface ThroughputMetric {
  perChannel?: { channel: string; tps: number }[];
  aggregateTps?: number;
}

export interface RunMetrics {
  throughput?: ThroughputMetric;
  latency?: {
    writeMs?: LatencyStat; // submit-to-commit write latency (Caliper)
    verificationMs?: LatencyStat; // audit/verification latency (Anchoring variants)
  };
  success?: { succ?: number; fail?: number; failureModes?: Record<string, number> };
  bytePerLog?: number; // slope from regress() over the checkpoint series
}

export interface Checkpoint {
  runId?: string;
  label?: string; // e.g. "t0", "t1"
  ts?: string; // legacy alias; collect.py writes tsUtc
  tsUtc?: string;
  ledgerBytes?: Record<string, number>; // per-channel block-store bytes (du -sb)
  stateBytes?: number; // GoLevelDB world-state bytes (summed per container)
  receiptBytes?: number | null; // receipt-store volume (anchoring variants)
  events?: number; // cumulative successful events (x-axis for byte-per-log)
}

export type RunStatus =
  | 'requested'
  | 'running'
  | 'completed'
  | 'failed'
  | 'unknown'
  | string;

export interface RunManifest {
  runId: string;
  startedAt?: string;
  variant?: Variant;
  regime?: Regime;
  cell?: SweepCell;
  gitCommit?: string;
  configShas?: Record<string, string>;
  caliper?: { binding?: string; version?: string };
  notes?: string;
}

// GET /runs/:id returns the manifest, plus (when available) status, metrics and
// the checkpoint series. Fields beyond runId may be absent for pending runs.
export interface RunDetail extends RunManifest {
  status?: RunStatus;
  metrics?: RunMetrics;
  checkpoints?: Checkpoint[];
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
}

/** PATCH /evidence/:id/details payload (M19): string sets, null clears. */
export interface EvidenceDetailsPatch {
  label?: string | null;
  categoryId?: string | null;
  seizedAt?: string | null;
  acquisitionLocation?: string | null;
  handedOverBy?: string | null;
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
  caseId?: string;
  uploadedBy?: string;
  type?: string;
  from?: string;
  to?: string;
}
