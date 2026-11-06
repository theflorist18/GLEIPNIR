package main

import (
	"fmt"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

// Composite-key object types (the first component of every CreateCompositeKey).
// These namespaces partition the world state and drive the MVCC design
// (docs/CONTRACTS.md §3):
//   - "evd"  head record, one per evidence  (serial writers only)
//   - "evt"  append-only audit events        (distinct key per tx -> no conflict)
//   - "root" anchor Merkle roots             (keyed by scope+batch)
const (
	objectTypeHead  = "evd"
	objectTypeEvent = "evt"
	objectTypeRoot  = "root"
)

// defaultScopeID is the anchor-root scope used when metaJSON carries no caseId
// (the single-channel Anchoring variant). See docs/CONTRACTS.md §3.
const defaultScopeID = "shared"

// sortKey builds the second component of an event composite key:
//
//	fmt.Sprintf("%019d", txTimestampUnixNanos) + "-" + txID[:12]
//
// The 19-digit zero pad (the width of math.MaxInt64, which bounds
// Unix-nanosecond timestamps for all realistic dates) makes lexical string
// order equal numeric order.
//
// Both inputs come from the signed transaction proposal, so the sortKey is
// deterministic across endorsers and unique per transaction, with no shared
// counter key (docs/CONTRACTS.md §3). It orders by the client's proposal
// timestamp, not commit order: skewed client clocks can reorder the trail
// (not a concern on the single-host benchmark, which has one clock).
// Concurrent AccessLog calls to the same evidence therefore write distinct
// keys, so they cannot raise MVCC_READ_CONFLICT; no client-side retry needed.
func sortKey(ts *timestamppb.Timestamp, txID string) string {
	return fmt.Sprintf("%019d-%s", ts.AsTime().UnixNano(), txID[:min(len(txID), 12)])
}

// tsToRFC3339 renders a tx timestamp as RFC3339 UTC. Derived from the proposal
// timestamp (not wall-clock), so it is identical across endorsers.
func tsToRFC3339(ts *timestamppb.Timestamp) string {
	return ts.AsTime().Format(time.RFC3339Nano)
}
