package main

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"

	"github.com/hyperledger/fabric-chaincode-go/v2/shim"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
	"github.com/hyperledger/fabric-protos-go-apiv2/ledger/queryresult"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// memStub is a minimal in-memory ChaincodeStubInterface. It embeds the
// interface so it satisfies the full contract at compile time; only the methods
// the chaincode actually calls are implemented (any other call would panic,
// which is the intended signal that a test exercised an unmodelled path).
//
// The composite-key encoding mirrors the real shim exactly
// ("\x00" + objectType + "\x00" + attr + "\x00" ...), so partial-key range
// scans behave like GoLevelDB.
type memStub struct {
	shim.ChaincodeStubInterface
	state map[string][]byte
	txID  string
	ts    *timestamppb.Timestamp
}

func newMemStub() *memStub {
	return &memStub{
		state: map[string][]byte{},
		// Real Fabric txIDs are 64-hex-char hashes; sortKey uses txID[:12], so
		// distinct transactions must differ within their first 12 chars. These
		// synthetic IDs are chosen to honor that (a collision here would mean two
		// events at the same nanosecond sharing a 12-char prefix — vanishingly
		// rare with real hash txIDs).
		txID: "a0create0000cafe0001",
		ts:   &timestamppb.Timestamp{Seconds: 1_700_000_000, Nanos: 0},
	}
}

const nul = "\x00"

func (m *memStub) CreateCompositeKey(objectType string, attributes []string) (string, error) {
	var b strings.Builder
	b.WriteString(nul)
	b.WriteString(objectType)
	b.WriteString(nul)
	for _, a := range attributes {
		b.WriteString(a)
		b.WriteString(nul)
	}
	return b.String(), nil
}

func (m *memStub) GetState(key string) ([]byte, error) { return m.state[key], nil }

func (m *memStub) PutState(key string, value []byte) error {
	cp := make([]byte, len(value))
	copy(cp, value)
	m.state[key] = cp
	return nil
}

func (m *memStub) DelState(key string) error { delete(m.state, key); return nil }

func (m *memStub) GetTxID() string { return m.txID }

func (m *memStub) GetTxTimestamp() (*timestamppb.Timestamp, error) { return m.ts, nil }

func (m *memStub) GetStateByPartialCompositeKey(objectType string, keys []string) (shim.StateQueryIteratorInterface, error) {
	prefix, _ := m.CreateCompositeKey(objectType, keys)
	matched := make([]string, 0)
	for k := range m.state {
		if strings.HasPrefix(k, prefix) {
			matched = append(matched, k)
		}
	}
	sort.Strings(matched) // GoLevelDB returns keys in lexical order
	return &memIterator{stub: m, keys: matched}, nil
}

type memIterator struct {
	stub *memStub
	keys []string
	pos  int
}

func (it *memIterator) HasNext() bool { return it.pos < len(it.keys) }

func (it *memIterator) Next() (*queryresult.KV, error) {
	k := it.keys[it.pos]
	it.pos++
	return &queryresult.KV{Key: k, Value: it.stub.state[k]}, nil
}

func (it *memIterator) Close() error { return nil }

// newCtx wires a memStub into a real contractapi TransactionContext.
func newCtx(stub *memStub) *contractapi.TransactionContext {
	ctx := new(contractapi.TransactionContext)
	ctx.SetStub(stub)
	return ctx
}

func sampleCodex(id string) string {
	entry := CodexEntry{
		ID:       id,
		Version:  "1.0",
		Storage:  &Storage{Protocol: "file", Location: "blob://x", IntegrityProof: "ni:///sha-256;abc", Jurisdiction: "ID"},
		Identity: &Identity{Org: "Org1MSP", Subject: "custodian-a"},
	}
	b, _ := json.Marshal(entry)
	return string(b)
}

func auditOps(t *testing.T, c *EvidenceContract, ctx contractapi.TransactionContextInterface, id string) []string {
	t.Helper()
	raw, err := c.GetAuditTrail(ctx, id)
	if err != nil {
		t.Fatalf("GetAuditTrail: %v", err)
	}
	var events []Event
	if err := json.Unmarshal([]byte(raw), &events); err != nil {
		t.Fatalf("unmarshal audit trail: %v", err)
	}
	ops := make([]string, len(events))
	for i, e := range events {
		ops[i] = e.Op
	}
	return ops
}

func TestCreateReadRoundtrip(t *testing.T) {
	c := &EvidenceContract{}
	stub := newMemStub()
	ctx := newCtx(stub)
	id := "ev-1"

	if err := c.CreateEvidence(ctx, id, sampleCodex(id)); err != nil {
		t.Fatalf("CreateEvidence: %v", err)
	}
	out, err := c.ReadEvidence(ctx, id)
	if err != nil {
		t.Fatalf("ReadEvidence: %v", err)
	}
	var head EvidenceHead
	if err := json.Unmarshal([]byte(out), &head); err != nil {
		t.Fatalf("unmarshal head: %v", err)
	}
	if head.Status != StatusActive {
		t.Errorf("status = %q, want ACTIVE", head.Status)
	}
	if head.Custodian != "custodian-a" {
		t.Errorf("custodian = %q, want custodian-a", head.Custodian)
	}
	if ops := auditOps(t, c, ctx, id); len(ops) != 1 || ops[0] != OpCreate {
		t.Errorf("audit ops = %v, want [CREATE]", ops)
	}
}

func TestDuplicateCreateRejected(t *testing.T) {
	c := &EvidenceContract{}
	ctx := newCtx(newMemStub())
	id := "ev-dup"
	if err := c.CreateEvidence(ctx, id, sampleCodex(id)); err != nil {
		t.Fatalf("first create: %v", err)
	}
	if err := c.CreateEvidence(ctx, id, sampleCodex(id)); err == nil {
		t.Fatal("duplicate CreateEvidence should fail")
	}
}

func TestTransferUpdatesCustodian(t *testing.T) {
	c := &EvidenceContract{}
	stub := newMemStub()
	ctx := newCtx(stub)
	id := "ev-2"
	mustCreate(t, c, ctx, id)

	stub.txID = "b1transfer00beef0002"
	if err := c.TransferCustody(ctx, id, "custodian-b", "handoff"); err != nil {
		t.Fatalf("TransferCustody: %v", err)
	}
	out, _ := c.ReadEvidence(ctx, id)
	var head EvidenceHead
	_ = json.Unmarshal([]byte(out), &head)
	if head.Custodian != "custodian-b" {
		t.Errorf("custodian = %q, want custodian-b", head.Custodian)
	}
	if ops := auditOps(t, c, ctx, id); strings.Join(ops, ",") != "CREATE,TRANSFER" {
		t.Errorf("audit ops = %v, want [CREATE TRANSFER]", ops)
	}
}

// The Stage-1 correctness gate in miniature: two AccessLog calls with the SAME
// tx timestamp but different txIDs must land on DISTINCT event keys (never a
// single mutated record), so the world state ends with both events.
func TestConcurrentAccessLogDistinctKeys(t *testing.T) {
	c := &EvidenceContract{}
	stub := newMemStub()
	ctx := newCtx(stub)
	id := "ev-3"
	mustCreate(t, c, ctx, id)

	before := len(stub.state)

	stub.txID = "txAAAAAAAAAAAAAAAAAA"
	if err := c.AccessLog(ctx, id, "alice", "view"); err != nil {
		t.Fatalf("AccessLog 1: %v", err)
	}
	// same timestamp, different txID
	stub.txID = "txBBBBBBBBBBBBBBBBBB"
	if err := c.AccessLog(ctx, id, "bob", "view"); err != nil {
		t.Fatalf("AccessLog 2: %v", err)
	}

	if got := len(stub.state) - before; got != 2 {
		t.Fatalf("access logging wrote %d keys, want 2 distinct keys", got)
	}
	if ops := auditOps(t, c, ctx, id); strings.Join(ops, ",") != "CREATE,ACCESS,ACCESS" {
		t.Errorf("audit ops = %v, want [CREATE ACCESS ACCESS]", ops)
	}
}

func TestRemoveIsTerminal(t *testing.T) {
	c := &EvidenceContract{}
	stub := newMemStub()
	ctx := newCtx(stub)
	id := "ev-4"
	mustCreate(t, c, ctx, id)

	stub.txID = "c2remove00dead0009ff"
	if err := c.RemoveEvidence(ctx, id, "disposed"); err != nil {
		t.Fatalf("RemoveEvidence: %v", err)
	}
	if err := c.TransferCustody(ctx, id, "custodian-z", "late"); err == nil {
		t.Fatal("TransferCustody after remove should fail")
	}
	if err := c.RemoveEvidence(ctx, id, "again"); err == nil {
		t.Fatal("second RemoveEvidence should fail")
	}
	// AccessLog after removal is deliberately still recorded (no head read).
	stub.txID = "d3access00feed000aee"
	if err := c.AccessLog(ctx, id, "auditor", "post-removal-view"); err != nil {
		t.Fatalf("post-removal AccessLog should be recorded, got: %v", err)
	}
}

func TestAuditTrailOrdering(t *testing.T) {
	c := &EvidenceContract{}
	stub := newMemStub()
	ctx := newCtx(stub)
	id := "ev-5"
	mustCreate(t, c, ctx, id)

	// Later events get later timestamps; iterator (sortKey) order must be stable.
	stub.ts = &timestamppb.Timestamp{Seconds: 1_700_000_005, Nanos: 0}
	stub.txID = "txZZZ000000000000001"
	_ = c.AccessLog(ctx, id, "a", "1")
	stub.ts = &timestamppb.Timestamp{Seconds: 1_700_000_003, Nanos: 0}
	stub.txID = "txAAA000000000000002"
	_ = c.AccessLog(ctx, id, "b", "2")

	ops := auditOps(t, c, ctx, id)
	// CREATE has the earliest timestamp (1_700_000_000); then the ts=...003 event,
	// then the ts=...005 event — ordering follows sortKey, not insertion order.
	if strings.Join(ops, ",") != "CREATE,ACCESS,ACCESS" {
		t.Errorf("ops = %v", ops)
	}
	raw, _ := c.GetAuditTrail(ctx, id)
	var events []Event
	_ = json.Unmarshal([]byte(raw), &events)
	if events[1].Actor != "b" || events[2].Actor != "a" {
		t.Errorf("ordering wrong: got actors %q then %q, want b then a", events[1].Actor, events[2].Actor)
	}
}

func TestAnchorRootScopeDefaultAndDuplicate(t *testing.T) {
	c := &EvidenceContract{}
	stub := newMemStub()
	ctx := newCtx(stub)

	// No caseId in meta -> scope defaults to "shared".
	if err := c.CommitAnchorRoot(ctx, "b1", "root-hash-1", `{"leafCount":10}`); err != nil {
		t.Fatalf("CommitAnchorRoot: %v", err)
	}
	out, err := c.ReadAnchorRoot(ctx, "shared", "b1")
	if err != nil {
		t.Fatalf("ReadAnchorRoot(shared,b1): %v", err)
	}
	var rec AnchorRoot
	_ = json.Unmarshal([]byte(out), &rec)
	if rec.ScopeID != "shared" || rec.MerkleRoot != "root-hash-1" || rec.LeafCount != 10 {
		t.Errorf("root record = %+v", rec)
	}
	// Duplicate (shared,b1) rejected.
	if err := c.CommitAnchorRoot(ctx, "b1", "root-hash-1b", `{"leafCount":10}`); err == nil {
		t.Fatal("duplicate CommitAnchorRoot should fail")
	}
	// Explicit caseId scopes the root; same batchId in a different scope is fine.
	if err := c.CommitAnchorRoot(ctx, "b1", "root-hash-2", `{"caseId":"case-001","leafCount":5}`); err != nil {
		t.Fatalf("scoped CommitAnchorRoot: %v", err)
	}
	if _, err := c.ReadAnchorRoot(ctx, "case-001", "b1"); err != nil {
		t.Fatalf("ReadAnchorRoot(case-001,b1): %v", err)
	}
}

func TestCreateRejectsBadCodex(t *testing.T) {
	c := &EvidenceContract{}
	ctx := newCtx(newMemStub())
	if err := c.CreateEvidence(ctx, "ev-bad", `{"id":"ev-bad"}`); err == nil {
		t.Fatal("CreateEvidence should reject a codex entry missing required fields")
	}
	if err := c.CreateEvidence(ctx, "ev-bad2", `not json`); err == nil {
		t.Fatal("CreateEvidence should reject invalid JSON")
	}
}

func mustCreate(t *testing.T, c *EvidenceContract, ctx contractapi.TransactionContextInterface, id string) {
	t.Helper()
	if err := c.CreateEvidence(ctx, id, sampleCodex(id)); err != nil {
		t.Fatalf("CreateEvidence(%s): %v", id, err)
	}
}
