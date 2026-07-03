package main

import "encoding/json"

// Record shapes for the evidence chaincode.
//
// Field naming follows docs/CONTRACTS.md sect. 5 exactly:
//   - The Codex-Entry mapping (ARCHITECTURE sect. 1a) uses snake_case member
//     names (integrity_proof, tx_hash, key_id, previous_id, ...).
//   - The on-chain event and anchor-root records use the camelCase member names
//     given verbatim in the CONTRACTS sect. 5 JSON examples.
// These are cross-module wire shapes; do not rename members without updating
// CONTRACTS.md.

// Status values for an evidence head record.
const (
	StatusActive  = "ACTIVE"
	StatusRemoved = "REMOVED" // terminal; no further mutation permitted
)

// Operation tags recorded on each audit event.
const (
	OpCreate   = "CREATE"
	OpTransfer = "TRANSFER"
	OpAccess   = "ACCESS"
	OpRemove   = "REMOVE"
)

// Storage is the off-chain binary pointer. integrity_proof is an RFC 6920
// ni-URI computed by the gateway, never by chaincode (CONTRACTS sect. 5).
type Storage struct {
	Protocol       string `json:"protocol"`
	Location       string `json:"location"`
	IntegrityProof string `json:"integrity_proof"`
	Jurisdiction   string `json:"jurisdiction"`
}

// Encryption is optional at-rest metadata carried only for encrypted evidence.
type Encryption struct {
	Alg              string `json:"alg"`
	KeyID            string `json:"key_id"`
	LastControlledBy string `json:"last_controlled_by"`
}

// Identity: org = owning MSP, subject = custodian (ARCHITECTURE sect. 1a).
type Identity struct {
	Org      string `json:"org"`
	Process  string `json:"process"`
	Artifact string `json:"artifact"`
	Subject  string `json:"subject"`
}

// Anchor records where the record was anchored (Fabric txID, or Merkle-root tx).
type Anchor struct {
	Chain   string `json:"chain"`
	TxHash  string `json:"tx_hash"`
	HashAlg string `json:"hash_alg"`
}

// Signature is one endorser/custodian signature.
type Signature struct {
	Alg       string `json:"alg"`
	Kid       string `json:"kid"`
	Signature string `json:"signature"`
}

// CodexEntry is the Codex-Entry-inspired evidence record supplied to
// CreateEvidence as codexEntryJSON. Required fields (validated on create):
// id, version, storage, identity. encryption/anchor/signatures/previous_id are
// optional and stored as provided.
type CodexEntry struct {
	ID         string      `json:"id"`
	Version    string      `json:"version"`
	Storage    *Storage    `json:"storage"`
	Encryption *Encryption `json:"encryption,omitempty"`
	Identity   *Identity   `json:"identity"`
	Anchor     *Anchor     `json:"anchor,omitempty"`
	Signatures []Signature `json:"signatures,omitempty"`
	PreviousID string      `json:"previous_id,omitempty"`
}

// EvidenceHead is the mutable "head" record stored under the "evd" composite
// key. It is the Codex-Entry mapping plus custodian and status (CONTRACTS
// sect. 5). Written ONLY by CreateEvidence/TransferCustody/RemoveEvidence,
// which are semantically serial per evidence. AccessLog never touches it.
type EvidenceHead struct {
	Codex     CodexEntry `json:"codex"`
	Custodian string     `json:"custodian"`
	Status    string     `json:"status"`
}

// Event is one append-only audit record stored under the "evt" composite key.
// Shape follows the CONTRACTS sect. 5 CoC event (camelCase members). ts and
// txId are taken from the signed proposal (GetTxTimestamp / GetTxID) so the
// record is byte-identical across endorsers (determinism requirement).
type Event struct {
	EvidenceID string            `json:"evidenceId"`
	Op         string            `json:"op"`
	Actor      string            `json:"actor"`
	Detail     map[string]string `json:"detail,omitempty"`
	TxID       string            `json:"txId"`
	Timestamp  string            `json:"ts"`
}

// AnchorRoot is the on-chain Merkle-root record stored under the "root"
// composite key. Shape per CONTRACTS sect. 5.
type AnchorRoot struct {
	ScopeID     string          `json:"scopeId"`
	BatchID     string          `json:"batchId"`
	MerkleRoot  string          `json:"merkleRoot"`
	LeafCount   int             `json:"leafCount"`
	Meta        json.RawMessage `json:"meta"`
	TxTimestamp string          `json:"txTimestamp"`
}

// anchorMeta is the subset of metaJSON the chaincode reads: caseId selects the
// root scope, leafCount is recorded on the root record. Unknown fields are
// preserved verbatim in AnchorRoot.Meta.
type anchorMeta struct {
	CaseID    string `json:"caseId"`
	LeafCount int    `json:"leafCount"`
}
