package main

import (
	"fmt"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

// Composite-key object types (the first component of every CreateCompositeKey).
// These namespaces partition the world state and drive the MVCC design
// (CONTRACTS sect. 3):
//   - "evd"  head record, one per evidence  (serial writers only)
//   - "evt"  append-only audit events        (distinct key per tx -> no conflict)
//   - "root" anchor Merkle roots             (keyed by scope+batch)
const (
	objectTypeHead  = "evd"
	objectTypeEvent = "evt"
	objectTypeRoot  = "root"
)

// defaultScopeID is the anchor-root scope used when metaJSON carries no caseId
// (the single-channel Anchoring variant). CONTRACTS sect. 3.
const defaultScopeID = "shared"

// zeroPad19 left-pads a non-negative int64 to 19 digits so that lexical string
// order over the padded values equals numeric order. 19 digits is the width of
// math.MaxInt64, which bounds Unix-nanosecond timestamps for all realistic
// dates, so no timestamp overflows the field.
func zeroPad19(n int64) string {
	return fmt.Sprintf("%019d", n)
}

// sortKey builds the second component of an event composite key:
//
//	zeroPad19(txTimestampUnixNanos) + "-" + txID[:12]
//
// Both inputs come from the signed transaction proposal, so the sortKey is
// deterministic across endorsers, unique per transaction, and ordered by the
// client's PROPOSAL timestamp — not commit order; skewed client clocks can
// reorder the trail (irrelevant on the single-host benchmark, one clock) —
// WITHOUT any shared counter key (CONTRACTS sect. 3). Concurrent
// AccessLog calls to the same evidence therefore write DISTINCT keys — zero
// MVCC_READ_CONFLICT by construction, not by client-side retry.
func sortKey(ts *timestamppb.Timestamp, txID string) string {
	nanos := ts.GetSeconds()*1_000_000_000 + int64(ts.GetNanos())
	tid := txID
	if len(tid) > 12 {
		tid = tid[:12]
	}
	return zeroPad19(nanos) + "-" + tid
}

// tsToRFC3339 renders a tx timestamp as RFC3339 UTC. Derived from the proposal
// timestamp (not wall-clock), so it is identical across endorsers.
func tsToRFC3339(ts *timestamppb.Timestamp) string {
	return time.Unix(ts.GetSeconds(), int64(ts.GetNanos())).UTC().Format(time.RFC3339Nano)
}
