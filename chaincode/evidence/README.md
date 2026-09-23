# chaincode/evidence

**Responsibility:** deterministically persist chain-of-custody audit records (and Merkle
roots) to a channel's world state — and nothing else. Used by **all four variants**.

Go 1.25.5, `fabric-contract-api-go/v2`, deployed as a **Chaincode-as-a-Service** (ccaas)
gRPC server (`main.go` reads `CHAINCODE_ID` + `CHAINCODE_SERVER_ADDRESS`). GoLevelDB
world state — key-value access only, **no rich queries**.

## Public interface (contractapi)

```go
CreateEvidence(ctx, evidenceId, codexEntryJSON string) error
TransferCustody(ctx, evidenceId, newCustodian, reason string) error
AccessLog(ctx, evidenceId, actor, action string) error
DisposeEvidence(ctx, evidenceId, reason string) error
CommitAnchorRoot(ctx, batchId, merkleRoot, metaJSON string) error   // Anchoring variants
ReadEvidence(ctx, evidenceId) (string, error)                       // evaluate
GetAuditTrail(ctx, evidenceId) (string, error)                      // evaluate
ReadAnchorRoot(ctx, scopeId, batchId) (string, error)              // evaluate
```

Inputs are strings (JSON where noted); outputs are JSON strings or errors. Record shapes:
`model.go` / docs/CONTRACTS.md §5.

## ISO/IEC 27037:2012 annotation

| Op | Process |
|---|---|
| `CreateEvidence` | Identification + first record of collection |
| `TransferCustody` | Preservation (documented custody transfer) |
| `AccessLog` | Preservation (auditability of access) |
| `DisposeEvidence` | Preservation (disposition — terminal; nothing is deleted, a status transition to `DISPOSED`) |

These annotations live as comments on the four ops in `contract.go`; keep them on refactor.

## State-key design (the MVCC-critical part)

- **Head** `("evd", [evidenceId])` — Codex-Entry metadata + custodian + status. Written
  ONLY by `CreateEvidence`/`TransferCustody`/`DisposeEvidence`, which are semantically
  serial per evidence (custody is a chain).
- **Event** `("evt", [evidenceId, sortKey])`, append-only, where
  `sortKey = zeroPad19(txTimestampUnixNanos) + "-" + txID[:12]`. Both parts come from the
  signed proposal (`GetTxTimestamp`/`GetTxID`), so keys are deterministic across endorsers,
  unique per tx, and commit-ordered — **without a shared counter key**.
- **Anchor root** `("root", [scopeId, batchId])`, `scopeId = meta.caseId || "shared"`.

**Why `AccessLog` never reads or writes the head:** any head access — even a "reject if
disposed" guard — would reintroduce a read-write conflict point, so concurrent access
logging to the same evidence would hit `MVCC_READ_CONFLICT`. Instead every access is
appended under its own distinct event key. Conflict avoidance is **structural, not a retry
loop**. A consequence, by design: an access logged *after* `DisposeEvidence` is recorded as
an audit event rather than rejected (auditability over gatekeeping).

## Endorsement policies (constant across all runs; applied at commit, docs/CONTRACTS.md §3)

- App channels `coc-main`, `case-*`: `OR('Org1MSP.peer','Org2MSP.peer')`.
- Anchor channel `anchor-main`: `AND('AnchorClientMSP.member')`.

## Does NOT

- Store evidence binaries (always off-chain, every variant).
- Hash payloads, compute `integrity_proof`, or sign (the gateway does hashing/ni-URIs).
- Reach other channels (cross-channel roots are submitted by the anchor-client).
- Run rich/range CouchDB queries (GoLevelDB; `GetAuditTrail` uses a partial-composite-key
  scan only).

## Failure modes

- `MVCC_READ_CONFLICT` — only possible on the serial head ops (concurrent
  transfer/dispose of the *same* evidence); correct behavior, not retried here. Access
  logging cannot produce it by construction.
- `ENDORSEMENT_POLICY_FAILURE` — insufficient endorsements at commit.
- key-not-found — read ops on an unknown evidenceId / (scopeId,batchId).
- duplicate — `CreateEvidence` on an existing id, or `CommitAnchorRoot` on an existing
  (scopeId,batchId), are rejected.

## Test / build

```bash
# host has no Go toolchain; build+test in the pinned container:
docker run --rm -v "$PWD":/src -w /src golang:1.25.5 go test ./... -v
```

`contract_test.go` uses an in-memory `ChaincodeStubInterface` stub (faithful composite-key
encoding) and covers create/read, duplicate rejection, transfer, the concurrent-access
distinct-key gate, terminal disposition (`TestDisposeIsTerminal`), audit ordering, and
anchor-root scoping. All pass.

## Versioning note (M26 rename `RemoveEvidence` → `DisposeEvidence`)

`CC_VERSION` stays `1.0`. The chaincode runs as ccaas, so the rebuilt binary is served
under the same package id — no new package/approve/commit cycle — and the git SHA the
thesis cites pins which code was deployed. Ledgers written before the rename carry
`op: "REMOVE"` / `status: "REMOVED"` rows; the library treats those as equivalent to
`DISPOSE` / `DISPOSED` when it reads them back, but this chaincode never writes them again.
