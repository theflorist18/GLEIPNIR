# Research digest — Hyperledger Fabric 2.5.x (LTS) + client/chaincode libraries

Verified: 2026-07-03. Every fact below was checked against a primary source on that date
(Docker Hub API, raw file contents of the `hyperledger/fabric` repo at tag `v2.5.16`/`v2.5.15`,
`hyperledger/fabric-samples` at `main` commit `c9b221e4a940da386cfadc3498a88085298d44be`,
the npm registry, and GitHub Releases). Nothing here is answered from memory.

---

## 1. Docker Hub tags — VERIFIED

Source: Docker Hub API, e.g. `https://hub.docker.com/v2/repositories/hyperledger/fabric-peer/tags/?page_size=100&name=2.5` (queried 2026-07-03).

- **`hyperledger/fabric-peer:2.5.15` EXISTS.** It is not the newest: **2.5.16 is the newest 2.5.x** (pushed 2026-06-17, linux/amd64 + linux/arm64).
- All five Fabric images publish the identical 2.5.x tag set (`2.5.0` … `2.5.16`, plus the moving `2.5` tag):

| Image | Newest 2.5.x tag | 2.5.15 exists? |
|---|---|---|
| `hyperledger/fabric-peer` | `2.5.16` | yes |
| `hyperledger/fabric-orderer` | `2.5.16` | yes |
| `hyperledger/fabric-tools` | `2.5.16` | yes |
| `hyperledger/fabric-ccenv` | `2.5.16` | yes |
| `hyperledger/fabric-baseos` | `2.5.16` | yes |

- **`hyperledger/fabric-ca:1.5.19` EXISTS.** Newest 1.5.x is **`1.5.21`** (pushed 2026-06-03). Full recent series: 1.5.19, 1.5.20, 1.5.21.
- **WARNING:** `hyperledger/fabric-peer:latest` currently resolves to the same digest as **`3.1.5`** (Fabric 3.x). The fabric-samples test-network compose files use `image: hyperledger/fabric-peer:latest` — GLEIPNIR must replace every `:latest` with a pinned 2.5.x tag or it will silently run Fabric 3.1.

**Exact strings to pin (matching the CLAUDE.md pinned stack, both verified to exist):**

```
hyperledger/fabric-peer:2.5.15
hyperledger/fabric-orderer:2.5.15
hyperledger/fabric-tools:2.5.15
hyperledger/fabric-ccenv:2.5.15
hyperledger/fabric-ca:1.5.19
```

(Newer patch tags `2.5.16` / `1.5.21` exist if the authors decide to bump the pin; do not mix patch levels across images.)

Sources:
- https://hub.docker.com/v2/repositories/hyperledger/fabric-peer/tags/?page_size=100&name=2.5
- https://hub.docker.com/v2/repositories/hyperledger/fabric-ca/tags/?page_size=100&name=1.5
- https://hub.docker.com/v2/repositories/hyperledger/fabric-peer/tags/latest/

---

## 2. Go toolchain inside `fabric-ccenv` — VERIFIED (from the image build definition)

The ccenv image installs whatever Go version the Fabric release's `go.mod` declares:
`Makefile` sets `GO_VER := $(shell grep '^go[ \t]' < go.mod)` and `images/ccenv/Dockerfile`
runs `curl -sL https://go.dev/dl/go${GO_VER}.${TARGETOS}-${TARGETARCH}.tar.gz` on Ubuntu 22.04.

| Image tag | Go toolchain shipped |
|---|---|
| `fabric-ccenv:2.5.16` | **Go 1.26.4** (`go 1.26.4` in `go.mod` at tag v2.5.16) |
| `fabric-ccenv:2.5.15` | **Go 1.26.0** (`go 1.26.0` in `go.mod` at tag v2.5.15) |

Optional runtime confirmation: `docker run --rm hyperledger/fabric-ccenv:2.5.15 go version`.

**Why this justifies chaincode-as-a-service:** GLEIPNIR pins chaincode Go at **1.25.5**. A
peer-side (`fabric-ccenv`) build would compile with Go 1.26.0/1.26.4 — a newer toolchain than
the pin, and one that changes with every Fabric patch release (1.26.0 → 1.26.4 between 2.5.15
and 2.5.16). A Go 1.26.x toolchain *can* compile a module whose `go.mod` says `go 1.25.5`
(backwards-compatible), so the build would not fail — but the toolchain actually used would
violate the version pin and is not reproducible across image bumps. With CCaaS you own the
chaincode Dockerfile (`FROM golang:1.25.5`) and the peer never compiles anything.

Sources:
- https://raw.githubusercontent.com/hyperledger/fabric/v2.5.16/Makefile (lines 85–86)
- https://raw.githubusercontent.com/hyperledger/fabric/v2.5.16/images/ccenv/Dockerfile
- https://raw.githubusercontent.com/hyperledger/fabric/v2.5.16/go.mod
- https://raw.githubusercontent.com/hyperledger/fabric/v2.5.15/go.mod

---

## 3. Chaincode-as-a-Service (CCaaS) on Fabric 2.5 — VERIFIED

### 3.1 The ccaas external builder ships enabled-by-default in the fabric-peer image

`images/peer/Dockerfile` (tag v2.5.16) runs `make ccaasbuilder` and copies the result into the
image at `/opt/hyperledger/ccaas_builder/bin`, and copies `sampleconfig/core.yaml` to
`/etc/hyperledger/fabric/core.yaml`. That `core.yaml` contains the builder entry **uncommented**
(sampleconfig/core.yaml lines 603–607 at v2.5.16):

```yaml
    externalBuilders:
       - name: ccaas_builder
         path: /opt/hyperledger/ccaas_builder
         propagateEnvironment:
           - CHAINCODE_AS_A_SERVICE_BUILDER_CONFIG
```

So any container started from `hyperledger/fabric-peer:2.5.x` can run CCaaS chaincode with no
extra builder config — **but** if you mount your own `core.yaml` (GLEIPNIR does, via
`FABRIC_CFG_PATH`), you must reproduce this `chaincode.externalBuilders` block in it.

The `CHAINCODE_AS_A_SERVICE_BUILDER_CONFIG` env var is set per peer in the test-network compose,
e.g. `CHAINCODE_AS_A_SERVICE_BUILDER_CONFIG={"peername":"peer0org1"}`; the builder uses it to
substitute the `{{.peername}}` template inside `connection.json` (see 3.2).

### 3.2 CCaaS package format

From `test-network/scripts/deployCCAAS.sh` (fabric-samples main @ c9b221e):

`connection.json` (goes inside `code.tar.gz`):

```json
{
  "address": "{{.peername}}_basic_ccaas:9999",
  "dial_timeout": "10s",
  "tls_required": false
}
```

`metadata.json` (sits next to `code.tar.gz` in the outer package):

```json
{
    "type": "ccaas",
    "label": "basic_1.0"
}
```

- `type` must be exactly `"ccaas"` for the built-in builder (`ccaas_builder`'s detect phase keys
  on it). Note: the older `asset-transfer-basic/chaincode-external` sample's own metadata.json
  says `"type": "external"` — that targets a *custom* sample builder, not the built-in one.
  Use `"ccaas"`.
- `label` becomes the human-readable prefix of the package ID.

**Assembly (exact commands from deployCCAAS.sh):**

```bash
mkdir -p "$tempdir/src" "$tempdir/pkg"
# write connection.json into $tempdir/src/, metadata.json into $tempdir/pkg/
tar -C "$tempdir/src" -czf "$tempdir/pkg/code.tar.gz" .
tar -C "$tempdir/pkg" -czf "$CC_NAME.tar.gz" metadata.json code.tar.gz
```

i.e. a `.tar.gz` containing exactly two entries: `metadata.json` and `code.tar.gz`
(the inner `code.tar.gz` containing `connection.json`).

### 3.3 Package ID

```bash
PACKAGE_ID=$(peer lifecycle chaincode calculatepackageid ${CC_NAME}.tar.gz)
```

`calculatepackageid` is a documented 2.5 subcommand (`peer lifecycle chaincode` docs at v2.5.16).
Result form: `<label>:<sha256>`, e.g.
`basic_1.0:0262396ccaffaa2174bc09f750f742319c4f14d60b16334d2c8921b6842c090c`.
It can be computed *before* install (deployCCAAS.sh does exactly that so the server container
can be configured with the ID); `peer lifecycle chaincode queryinstalled` returns the same ID
after install.

### 3.4 Env vars for the chaincode server container

Exact vars the current sample sets (`docker run` lines in deployCCAAS.sh):

```
CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999
CHAINCODE_ID=<PACKAGE_ID>
CORE_CHAINCODE_ID_NAME=<PACKAGE_ID>
```

deployCCAAS.sh sets **both** `CHAINCODE_ID` and `CORE_CHAINCODE_ID_NAME` to the package ID.
The Go CCaaS sample (`asset-transfer-basic/chaincode-external/assetTransfer.go`) reads
**`CHAINCODE_ID`** (and `CHAINCODE_SERVER_ADDRESS`); `CORE_CHAINCODE_ID_NAME` is what other
language shims/older samples read. Setting both is the safe, current-sample-conformant choice.
The `address` in connection.json must resolve, from the peer, to wherever
`CHAINCODE_SERVER_ADDRESS` is listening (same Docker network).

Sources:
- https://raw.githubusercontent.com/hyperledger/fabric/v2.5.16/images/peer/Dockerfile
- https://raw.githubusercontent.com/hyperledger/fabric/v2.5.16/sampleconfig/core.yaml
- https://github.com/hyperledger/fabric-samples/blob/c9b221e4a940da386cfadc3498a88085298d44be/test-network/scripts/deployCCAAS.sh
- https://raw.githubusercontent.com/hyperledger/fabric/v2.5.16/docs/source/commands/peerlifecycle.md
- https://github.com/hyperledger/fabric-samples/blob/c9b221e4a940da386cfadc3498a88085298d44be/asset-transfer-basic/chaincode-external/chaincode.env

---

## 4. Go chaincode server libraries — VERIFIED

- **`fabric-contract-api-go`: current major is v2; latest tag `v2.2.1`** (released 2026-03-23;
  GitHub Releases). Module path: `github.com/hyperledger/fabric-contract-api-go/v2`.
  **Minimum Go: `go 1.24.0`** (go.mod at v2.2.1). Chaincode pinned at Go 1.25.5 satisfies this.
- **`fabric-chaincode-go`** (the shim): latest release `v2.3.0` (2025-02-12), module path
  `github.com/hyperledger/fabric-chaincode-go/v2`.
- **There is no contractapi-native server.** The pattern (verified in
  `fabric-samples/asset-transfer-basic/chaincode-external/assetTransfer.go`, main branch) is:
  build the chaincode with `contractapi.NewChaincode(...)` and hand it to `shim.ChaincodeServer`.

`shim.ChaincodeServer` fields (verified from `shim/chaincodeserver.go` at fabric-chaincode-go v2.3.0):
`CCID string`, `Address string`, `CC Chaincode`, `TLSProps TLSProperties`,
`KaOpts *keepalive.ServerParameters`. `TLSProperties` = `{Disabled bool, Key, Cert, ClientCACerts []byte}`.

Sample server main (condensed from the fabric-samples file):

```go
import (
    "github.com/hyperledger/fabric-chaincode-go/v2/shim"
    "github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func main() {
    chaincode, err := contractapi.NewChaincode(&SmartContract{})
    if err != nil { log.Panicf("error creating chaincode: %s", err) }

    server := &shim.ChaincodeServer{
        CCID:     os.Getenv("CHAINCODE_ID"),             // package ID
        Address:  os.Getenv("CHAINCODE_SERVER_ADDRESS"), // e.g. 0.0.0.0:9999
        CC:       chaincode,
        TLSProps: shim.TLSProperties{Disabled: true},    // TLS off in the sample
    }
    if err := server.Start(); err != nil { log.Panicf("error starting chaincode: %s", err) }
}
```

**Branch caveat:** there is **no `release-2.5` branch of fabric-samples** (branches: main,
release-2.2, release-1.x; tags stop at v2.4.9 — GitHub API, 2026-07-03) and no directory named
`chaincode-go-ccaas`. The equivalents on `main` (commit c9b221e) are
`asset-transfer-basic/chaincode-external` (the CCaaS server sample above) and
`test-network/scripts/deployCCAAS.sh` (the packaging/deployment flow). Cite fabric-samples by
that commit SHA, not by a release-2.5 branch.

Sources:
- https://api.github.com/repos/hyperledger/fabric-contract-api-go/releases
- https://raw.githubusercontent.com/hyperledger/fabric-contract-api-go/v2.2.1/go.mod
- https://api.github.com/repos/hyperledger/fabric-chaincode-go/releases
- https://raw.githubusercontent.com/hyperledger/fabric-chaincode-go/v2.3.0/shim/chaincodeserver.go
- https://github.com/hyperledger/fabric-samples/blob/c9b221e4a940da386cfadc3498a88085298d44be/asset-transfer-basic/chaincode-external/assetTransfer.go
- https://api.github.com/repos/hyperledger/fabric-samples/branches / .../tags

---

## 5. configtx.yaml for a 2.5 channel-participation network — VERIFIED

Reference: `test-network/configtx/configtx.yaml`, fabric-samples main @ c9b221e (the file the
2.5 docs' test-network uses; there is no consortium/system-genesis section anywhere in it).

**Which capabilities exist in Fabric 2.5.16 (verified in `common/capabilities/*.go` source):**
- Channel: only `V2_0` (constant `ChannelV2_0 = "V2_0"`; no V2_5, no V3_0 at this tag)
- Orderer: only `V2_0` (`OrdererV2_0 = "V2_0"`)
- Application: `V2_0` **and** `V2_5` (`ApplicationV2_5 = "V2_5"` — enables private-data purge)

**Use: Channel `V2_0: true`, Orderer `V2_0: true`, Application `V2_5: true`** — exactly what the
test-network configtx.yaml sets. (`Application: V2_0` also works if purge is not needed; there is
no `V2_5` for Channel or Orderer — setting one would be rejected.)

Shape of the application-channel profile (no `Consortiums`, no system-channel profile; the
profile directly contains Orderer + Application):

```yaml
Profiles:
  ChannelUsingRaft:                # configtxgen -profile ChannelUsingRaft -outputBlock ... -channelID ...
    <<: *ChannelDefaults           # Channel policies + Capabilities: { V2_0: true }
    Orderer:
      <<: *OrdererDefaults         # BatchTimeout: 2s, BatchSize {MaxMessageCount: 10, AbsoluteMaxBytes: 99 MB, PreferredMaxBytes: 512 KB}, Addresses, Policies
      OrdererType: etcdraft
      EtcdRaft:
        Consenters:
          - Host: orderer.example.com
            Port: 7050
            ClientTLSCert: ../organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.crt
            ServerTLSCert: ../organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.crt
      Organizations:
        - *OrdererOrg              # has OrdererEndpoints: [orderer.example.com:7050]
      Capabilities: *OrdererCapabilities   # { V2_0: true }
    Application:
      <<: *ApplicationDefaults     # ImplicitMeta policies incl. LifecycleEndorsement/Endorsement: MAJORITY Endorsement
      Organizations:
        - *Org1
        - *Org2
      Capabilities: *ApplicationCapabilities  # { V2_5: true }
```

Notes for GLEIPNIR (3 orderers): add one `Consenters` entry per orderer, each with its own
`Host`/`Port`/`ClientTLSCert`/`ServerTLSCert` (test-network points both cert fields at the same
`tls/server.crt` of that orderer) and list every orderer endpoint under the orderer org's
`OrdererEndpoints`. Peer orgs carry `Endorsement: OR('OrgXMSP.peer')` signature policies.
Genesis block per channel: `configtxgen -profile ChannelUsingRaft -outputBlock ./channel-artifacts/<ch>.block -channelID <ch>`
(from `test-network/scripts/createChannel.sh`).

Sources:
- https://github.com/hyperledger/fabric-samples/blob/c9b221e4a940da386cfadc3498a88085298d44be/test-network/configtx/configtx.yaml
- https://raw.githubusercontent.com/hyperledger/fabric/v2.5.16/common/capabilities/application.go / channel.go / orderer.go
- https://github.com/hyperledger/fabric-samples/blob/c9b221e4a940da386cfadc3498a88085298d44be/test-network/scripts/createChannel.sh

---

## 6. `osnadmin channel join` — VERIFIED

Command reference at v2.5.16 (`docs/source/commands/osnadminchannel.md`):

```
osnadmin channel join \
  -o orderer.example.com:9443 \            # -o / --orderer-address = admin endpoint of the OSN
  --ca-file $CA_FILE \                     # PEM TLS CA cert(s) of the OSN
  --client-cert $CLIENT_CERT \             # PEM X509 cert for MUTUAL TLS with the OSN
  --client-key $CLIENT_KEY \               # PEM private key for mutual TLS
  --channelID mychannel \                  # -c / --channelID
  --config-block mychannel-genesis-block.pb   # -b / --config-block (genesis or latest config block)
```

Extra flag: `--no-status` (suppresses the HTTP status line). Subcommands: `join`, `list`, `remove`.

**Success semantics — HTTP 201** with the channel-info JSON (verbatim from the docs):

```
Status: 201
{
  "name": "mychannel",
  "url": "/participation/v1/channels/mychannel",
  "consensusRelation": "consenter",
  "status": "active",
  "height": 1
}
```

"If the channel does not yet exist, it will be created." `channel list` returns 200; `channel
remove` returns 204. GLEIPNIR's `provision-channel.sh` should assert `Status: 201` per orderer.

**Orderer config needed for the admin endpoint** (env form, verified in test-network
`compose-test-net.yaml`; YAML form in `sampleconfig/orderer.yaml` at v2.5.16):

```
ORDERER_GENERAL_BOOTSTRAPMETHOD=none            # no bootstrap genesis; channel-participation only
ORDERER_CHANNELPARTICIPATION_ENABLED=true       # orderer.yaml ChannelParticipation.Enabled (default: false!)
ORDERER_ADMIN_LISTENADDRESS=0.0.0.0:7053        # orderer.yaml Admin.ListenAddress (default 127.0.0.1:9443)
ORDERER_ADMIN_TLS_ENABLED=true
ORDERER_ADMIN_TLS_CERTIFICATE=/var/hyperledger/orderer/tls/server.crt
ORDERER_ADMIN_TLS_PRIVATEKEY=/var/hyperledger/orderer/tls/server.key
ORDERER_ADMIN_TLS_ROOTCAS=[/var/hyperledger/orderer/tls/ca.crt]
ORDERER_ADMIN_TLS_CLIENTROOTCAS=[/var/hyperledger/orderer/tls/ca.crt]
```

**Mutual-TLS is mandatory on the admin endpoint when TLS is on.** sampleconfig/orderer.yaml,
Admin.TLS.ClientAuthRequired (default `true`): "When TLS is enabled, the admin endpoint requires
mutual TLS. The orderer will panic on startup if this value is set to false." The client
cert/key passed to `--client-cert/--client-key` must chain to `Admin.TLS.ClientRootCAs`
(test-network simply reuses the orderer's own `tls/server.crt`/`server.key` as the admin client
pair — see `test-network/scripts/orderer.sh`).

Sources:
- https://raw.githubusercontent.com/hyperledger/fabric/v2.5.16/docs/source/commands/osnadminchannel.md
- https://raw.githubusercontent.com/hyperledger/fabric/v2.5.16/sampleconfig/orderer.yaml (Admin:, ChannelParticipation:)
- https://github.com/hyperledger/fabric-samples/blob/c9b221e4a940da386cfadc3498a88085298d44be/test-network/compose/compose-test-net.yaml
- https://github.com/hyperledger/fabric-samples/blob/c9b221e4a940da386cfadc3498a88085298d44be/test-network/scripts/orderer.sh

---

## 7. `@hyperledger/fabric-gateway` (npm) — VERIFIED

- **Current version to pin: `1.11.0`** (dist-tag `latest`, published 2026-05-06; npm registry).
- **No `peerDependencies`.** Regular dependencies of 1.11.0:
  `@grpc/grpc-js ^1.14.0`, `@hyperledger/fabric-protos ^0.3.0`, `@noble/curves ^1.9.4`,
  `google-protobuf ^3.21.0`. Engines: **`node >=20.9.0`** (Node 20.19 pin satisfies this).
- Requires **Fabric v2.4+ with a gateway-enabled peer** (package README "Compatibility").
- You construct the gRPC connection yourself with `@grpc/grpc-js` and pass it in; the API is
  `connect() → Gateway.getNetwork() → Network.getContract() → submitTransaction()/evaluateTransaction()`.

Minimal connect (condensed verbatim from
`fabric-samples/asset-transfer-basic/application-gateway-typescript/src/app.ts`, main @ c9b221e):

```ts
import * as grpc from '@grpc/grpc-js';
import { connect, hash, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'crypto';

const tlsRootCert = await fs.readFile(tlsCertPath);          // peer's TLS CA cert
const client = new grpc.Client(peerEndpoint,                  // e.g. 'localhost:7051'
    grpc.credentials.createSsl(tlsRootCert),
    { 'grpc.ssl_target_name_override': peerHostAlias });      // e.g. 'peer0.org1.example.com'

const gateway = connect({
    client,
    identity: { mspId, credentials: certPem },                // X.509 cert PEM bytes
    signer: signers.newPrivateKeySigner(crypto.createPrivateKey(privateKeyPem)),
    hash: hash.sha256,
    evaluateOptions:     () => ({ deadline: Date.now() + 5000 }),
    endorseOptions:      () => ({ deadline: Date.now() + 15000 }),
    submitOptions:       () => ({ deadline: Date.now() + 5000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
});

const network  = gateway.getNetwork(channelName);
const contract = network.getContract(chaincodeName);
await contract.submitTransaction('CreateEvidence', ...args);   // endorse -> order -> commit
const bytes = await contract.evaluateTransaction('ReadEvidence', id);  // read-only
// on shutdown: gateway.close(); client.close();
```

The gRPC `client` should be shared by all Gateway connections to the same peer endpoint
(comment in the sample). One gateway connection per client identity.

Sources:
- https://registry.npmjs.org/@hyperledger/fabric-gateway (versions, dist-tags, dependencies, engines, readme)
- https://github.com/hyperledger/fabric-samples/blob/c9b221e4a940da386cfadc3498a88085298d44be/asset-transfer-basic/application-gateway-typescript/src/app.ts

---

## 8. `core.yaml` / `orderer.yaml` defaults in 2.5 — VERIFIED (sampleconfig at v2.5.16)

**`peer.gateway`** (this exact block, `sampleconfig/core.yaml` lines 49–61):

```yaml
peer:
    gateway:
        enabled: true            # gateway service on the peer
        endorsementTimeout: 30s  # wait for endorsing peers
        broadcastTimeout: 30s    # wait for ordering nodes
        dialTimeout: 2m          # wait for connections to other network nodes
```

**Gateway concurrency limit = 500** lives at **`peer.limits.concurrency.gatewayService`**
(NOT under `peer.gateway`):

```yaml
peer:
    limits:
        concurrency:
            endorserService: 2500
            deliverService: 2500
            gatewayService: 500   # concurrent gateway requests (submit/evaluate)
```

Env override form: `CORE_PEER_LIMITS_CONCURRENCY_GATEWAYSERVICE=500`.

**State database** (GoLevelDB is already the default):

```yaml
ledger:
  state:
    stateDatabase: goleveldb     # options: "goleveldb", "CouchDB"
    totalQueryLimit: 100000
```

**`orderer.yaml` `General.Cluster.SendBufferSize` default = 100 in 2.5 — confirmed:**

```yaml
General:
    Cluster:
        # SendBufferSize is the maximum number of messages in the egress buffer.
        # Consensus messages are dropped if the buffer is full, and transaction
        # messages are waiting for space to be freed.
        SendBufferSize: 100
```

(Env override: `ORDERER_GENERAL_CLUSTER_SENDBUFFERSIZE`.)

Also relevant, verified in the same files: peer image default `FABRIC_CFG_PATH` is
`/etc/hyperledger/fabric` (peer Dockerfile) and test-network overrides it to
`/etc/hyperledger/peercfg`; orderer `Admin.ListenAddress` default `127.0.0.1:9443`;
`ChannelParticipation.Enabled` default `false` (must be set true, see §6).

Sources:
- https://raw.githubusercontent.com/hyperledger/fabric/v2.5.16/sampleconfig/core.yaml
- https://raw.githubusercontent.com/hyperledger/fabric/v2.5.16/sampleconfig/orderer.yaml

---

## Verification status summary

| # | Item | Status |
|---|---|---|
| 1 | Docker Hub tags (2.5.15 / 2.5.16, 1.5.19 / 1.5.21) | VERIFIED (Docker Hub API) |
| 2 | ccenv Go = 1.26.0 (2.5.15) / 1.26.4 (2.5.16) | VERIFIED via image build definition (Makefile + Dockerfile + go.mod at the git tags); not re-confirmed by pulling the image — run `docker run --rm hyperledger/fabric-ccenv:2.5.15 go version` on first pull |
| 3 | ccaas builder default + package format + calculatepackageid + env vars | VERIFIED (fabric v2.5.16 source, fabric-samples main @ c9b221e) |
| 4 | contract-api-go v2.2.1, go ≥1.24.0, shim.ChaincodeServer fields | VERIFIED (GitHub releases + raw source) |
| 5 | configtx.yaml shape; capabilities Channel/Orderer V2_0, Application V2_5 | VERIFIED (fabric-samples configtx.yaml + fabric capabilities source). Caveat: no fabric-samples release-2.5 branch exists — cite main @ c9b221e |
| 6 | osnadmin flags, HTTP 201, admin endpoint config, mutual-TLS panic rule | VERIFIED (fabric v2.5.16 docs + sampleconfig + test-network) |
| 7 | fabric-gateway 1.11.0, deps/engines, connect example | VERIFIED (npm registry + fabric-samples app.ts) |
| 8 | peer.gateway keys, gatewayService=500 key path, goleveldb, SendBufferSize=100 | VERIFIED (sampleconfig at v2.5.16) |
