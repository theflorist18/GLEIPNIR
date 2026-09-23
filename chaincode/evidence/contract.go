package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// EvidenceContract deterministically persists chain-of-custody audit records
// (and Merkle roots) to a channel's world state. It does nothing else: no
// off-chain binaries, no payload hashing, no signing, no cross-channel writes
// (ARCHITECTURE sect. 4.1).
type EvidenceContract struct {
	contractapi.Contract
}

// ---- write operations (the four CoC ops + anchor-root commit) ----

// CreateEvidence registers a new source of potential evidence.
//
// ISO/IEC 27037: Identification + first record of collection.
func (c *EvidenceContract) CreateEvidence(ctx contractapi.TransactionContextInterface, evidenceId, codexEntryJSON string) error {
	stub := ctx.GetStub()

	headKey, err := stub.CreateCompositeKey(objectTypeHead, []string{evidenceId})
	if err != nil {
		return err
	}
	existing, err := stub.GetState(headKey)
	if err != nil {
		return err
	}
	if existing != nil {
		return fmt.Errorf("evidence %q already exists", evidenceId)
	}

	var entry CodexEntry
	if err := json.Unmarshal([]byte(codexEntryJSON), &entry); err != nil {
		return fmt.Errorf("invalid codex entry JSON: %w", err)
	}
	// Minimal Codex-Entry validation (ARCHITECTURE sect. 1a required fields).
	if entry.ID == "" || entry.Version == "" || entry.Storage == nil || entry.Identity == nil {
		return fmt.Errorf("codex entry missing required field (id, version, storage, identity)")
	}

	custodian := entry.Identity.Subject
	head := EvidenceHead{CodexEntry: entry, Custodian: custodian, Status: StatusActive}
	headBytes, err := json.Marshal(head)
	if err != nil {
		return err
	}
	if err := stub.PutState(headKey, headBytes); err != nil {
		return err
	}
	return c.appendEvent(ctx, evidenceId, OpCreate, custodian, nil)
}

// TransferCustody documents a custody transfer while preserving integrity.
// Custody is a chain, so head writes are serial per evidence; a concurrent
// transfer of the SAME evidence conflicting via MVCC is the correct outcome and
// must NOT be retried by the caller (ARCHITECTURE sect. 4.1).
//
// ISO/IEC 27037: Preservation.
func (c *EvidenceContract) TransferCustody(ctx contractapi.TransactionContextInterface, evidenceId, newCustodian, reason string) error {
	stub := ctx.GetStub()

	head, headKey, err := c.readActiveHead(ctx, evidenceId)
	if err != nil {
		return err
	}

	head.Custodian = newCustodian
	headBytes, err := json.Marshal(head)
	if err != nil {
		return err
	}
	if err := stub.PutState(headKey, headBytes); err != nil {
		return err
	}
	return c.appendEvent(ctx, evidenceId, OpTransfer, newCustodian, map[string]string{
		"newCustodian": newCustodian,
		"reason":       reason,
	})
}

// AccessLog records who accessed the evidence and what action was taken.
//
// It MUST NOT read or write the head key (the structural zero-conflict
// guarantee, and the thesis gate): any head read here — even a "reject if
// disposed" check — would reintroduce a conflict point under concurrent access.
// So access is ALWAYS appended, even after DisposeEvidence; a post-disposal
// access is deliberately recorded as an audit event rather than rejected.
//
// ISO/IEC 27037: Preservation (auditability of access).
func (c *EvidenceContract) AccessLog(ctx contractapi.TransactionContextInterface, evidenceId, actor, action string) error {
	return c.appendEvent(ctx, evidenceId, OpAccess, actor, map[string]string{
		"action": action,
	})
}

// DisposeEvidence sets the terminal DISPOSED status. After this, further
// TransferCustody / DisposeEvidence calls fail (head no longer ACTIVE).
//
// ISO/IEC 27037: Preservation (disposition) — nothing is deleted; a status
// transition. The head record and every audit event stay on the ledger.
func (c *EvidenceContract) DisposeEvidence(ctx contractapi.TransactionContextInterface, evidenceId, reason string) error {
	stub := ctx.GetStub()

	head, headKey, err := c.readActiveHead(ctx, evidenceId)
	if err != nil {
		return err
	}

	head.Status = StatusDisposed
	headBytes, err := json.Marshal(head)
	if err != nil {
		return err
	}
	if err := stub.PutState(headKey, headBytes); err != nil {
		return err
	}
	return c.appendEvent(ctx, evidenceId, OpDispose, "", map[string]string{
		"reason": reason,
	})
}

// CommitAnchorRoot stores a Merkle root for one batch (Anchoring variants).
// scopeId = metaJSON.caseId, defaulting to "shared". Roots are keyed on
// (scopeId, batchId) so distinct batches never collide; a duplicate commit for
// the same (scopeId, batchId) is rejected.
func (c *EvidenceContract) CommitAnchorRoot(ctx contractapi.TransactionContextInterface, batchId, merkleRoot, metaJSON string) error {
	stub := ctx.GetStub()

	if metaJSON == "" {
		metaJSON = "{}"
	}
	var meta anchorMeta
	if err := json.Unmarshal([]byte(metaJSON), &meta); err != nil {
		return fmt.Errorf("invalid meta JSON: %w", err)
	}
	scopeID := meta.CaseID
	if scopeID == "" {
		scopeID = defaultScopeID
	}

	rootKey, err := stub.CreateCompositeKey(objectTypeRoot, []string{scopeID, batchId})
	if err != nil {
		return err
	}
	existing, err := stub.GetState(rootKey)
	if err != nil {
		return err
	}
	if existing != nil {
		return fmt.Errorf("anchor root for scope %q batch %q already exists", scopeID, batchId)
	}

	ts, err := stub.GetTxTimestamp()
	if err != nil {
		return err
	}
	record := AnchorRoot{
		ScopeID:     scopeID,
		BatchID:     batchId,
		MerkleRoot:  merkleRoot,
		LeafCount:   meta.LeafCount,
		Meta:        json.RawMessage(metaJSON),
		TxTimestamp: tsToRFC3339(ts),
	}
	recordBytes, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return stub.PutState(rootKey, recordBytes)
}

// ---- read operations (evaluate) ----

// ReadEvidence returns the head record JSON for evidenceId.
func (c *EvidenceContract) ReadEvidence(ctx contractapi.TransactionContextInterface, evidenceId string) (string, error) {
	stub := ctx.GetStub()
	headKey, err := stub.CreateCompositeKey(objectTypeHead, []string{evidenceId})
	if err != nil {
		return "", err
	}
	headBytes, err := stub.GetState(headKey)
	if err != nil {
		return "", err
	}
	if headBytes == nil {
		return "", fmt.Errorf("evidence %q not found", evidenceId)
	}
	return string(headBytes), nil
}

// GetAuditTrail returns the append-only event records for evidenceId as a JSON
// array in iterator (sortKey) order.
func (c *EvidenceContract) GetAuditTrail(ctx contractapi.TransactionContextInterface, evidenceId string) (string, error) {
	stub := ctx.GetStub()
	iter, err := stub.GetStateByPartialCompositeKey(objectTypeEvent, []string{evidenceId})
	if err != nil {
		return "", err
	}
	defer iter.Close()

	events := make([]json.RawMessage, 0)
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return "", err
		}
		events = append(events, json.RawMessage(kv.Value))
	}
	out, err := json.Marshal(events)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// ReadAnchorRoot returns the anchor-root record JSON for (scopeId, batchId).
// scopeId is a caseId, or "shared" for the single-channel Anchoring variant.
func (c *EvidenceContract) ReadAnchorRoot(ctx contractapi.TransactionContextInterface, scopeId, batchId string) (string, error) {
	stub := ctx.GetStub()
	rootKey, err := stub.CreateCompositeKey(objectTypeRoot, []string{scopeId, batchId})
	if err != nil {
		return "", err
	}
	rootBytes, err := stub.GetState(rootKey)
	if err != nil {
		return "", err
	}
	if rootBytes == nil {
		return "", fmt.Errorf("anchor root for scope %q batch %q not found", scopeId, batchId)
	}
	return string(rootBytes), nil
}

// ---- internal helpers ----

// readActiveHead loads the head record and requires it to be ACTIVE. Used by
// the serial mutating ops (TransferCustody, DisposeEvidence). AccessLog does NOT
// use this — it never reads the head.
func (c *EvidenceContract) readActiveHead(ctx contractapi.TransactionContextInterface, evidenceId string) (EvidenceHead, string, error) {
	stub := ctx.GetStub()
	headKey, err := stub.CreateCompositeKey(objectTypeHead, []string{evidenceId})
	if err != nil {
		return EvidenceHead{}, "", err
	}
	headBytes, err := stub.GetState(headKey)
	if err != nil {
		return EvidenceHead{}, "", err
	}
	if headBytes == nil {
		return EvidenceHead{}, "", fmt.Errorf("evidence %q not found", evidenceId)
	}
	var head EvidenceHead
	if err := json.Unmarshal(headBytes, &head); err != nil {
		return EvidenceHead{}, "", err
	}
	if head.Status != StatusActive {
		return EvidenceHead{}, "", fmt.Errorf("evidence %q is not ACTIVE (status %s)", evidenceId, head.Status)
	}
	return head, headKey, nil
}

// appendEvent writes one immutable audit event under the "evt" composite key.
// The sortKey (proposal timestamp + txID) makes every event key distinct and
// proposal-time-ordered without a shared counter — the MVCC-conflict-free design.
func (c *EvidenceContract) appendEvent(ctx contractapi.TransactionContextInterface, evidenceId, op, actor string, detail map[string]string) error {
	stub := ctx.GetStub()
	ts, err := stub.GetTxTimestamp()
	if err != nil {
		return err
	}
	txID := stub.GetTxID()

	eventKey, err := stub.CreateCompositeKey(objectTypeEvent, []string{evidenceId, sortKey(ts, txID)})
	if err != nil {
		return err
	}
	event := Event{
		EvidenceID: evidenceId,
		Op:         op,
		Actor:      actor,
		Detail:     detail,
		TxID:       txID,
		Timestamp:  tsToRFC3339(ts),
	}
	eventBytes, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return stub.PutState(eventKey, eventBytes)
}

// compile-time assertion that EvidenceContract satisfies the contract API.
var _ contractapi.ContractInterface = (*EvidenceContract)(nil)
