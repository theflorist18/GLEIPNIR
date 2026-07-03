# fabric-samples patterns for GLEIPNIR (Fabric 2.5 LTS)

Research digest, 2026-07-03. Every snippet below was fetched from raw file contents on GitHub
(not recalled from memory). Source-of-truth commit is pinned; copy URLs verbatim.

## 0. Branch reality check — there is NO `release-2.5` branch (VERIFIED)

- **VERIFIED:** `hyperledger/fabric-samples` has branches `main`, `release`, `release-1.0`…`release-1.4`, `release-2.2` — **no `release-2.5`** (GitHub API: https://api.github.com/repos/hyperledger/fabric-samples/branches?per_page=100). Tags end at **`v2.4.9`** (https://api.github.com/repos/hyperledger/fabric-samples/tags).
- **VERIFIED:** Fabric's own `install-fabric.sh` on the **fabric `release-2.5` branch** clones fabric-samples `main` and tries `git checkout v${VERSION}`; since no `v2.5.x` tag exists it prints *"fabric-samples v${VERSION} does not exist, defaulting to main. fabric-samples main branch is intended to work with recent versions of fabric."* and stays on `main`. Its current defaults are `_arg_fabric_version="2.5.16"`, `_arg_ca_version="1.5.15"`.
  Source: https://raw.githubusercontent.com/hyperledger/fabric/release-2.5/scripts/install-fabric.sh
- **Consequence:** the authoritative "2.5-era test-network" is fabric-samples **`main`**. This digest pins commit **`c9b221e4a940da386cfadc3498a88085298d44be`** (HEAD of `main` on 2026-07-03); all raw URLs below use that SHA so they can never drift.
- **Caution (drift on main):** `main` also carries Fabric 3.x-era additions — a `-bft` mode (`ChannelUsingBFT` profile, `compose-bft-test-net.yaml`, 4 orderers) and a 4-orderer loop in `registerEnroll.sh`. For GLEIPNIR (2.5.15, etcdraft) use only the **Raft path** (`ChannelUsingRaft`, `compose-test-net.yaml`, `scripts/orderer.sh`); ignore everything BFT-flagged.
- **VERIFIED image tags on Docker Hub** (hub.docker.com/v2 API): `hyperledger/fabric-peer:2.5.15`, `hyperledger/fabric-tools:2.5.15`, `hyperledger/fabric-ca:1.5.19` all exist (CA tags go up to 1.5.21). **The compose files on `main` say `:latest` — GLEIPNIR must rewrite every image to the pinned tag** (`fabric-peer:2.5.15`, `fabric-orderer:2.5.15`, `fabric-ca:1.5.19`, `fabric-tools:2.5.15`).
  - https://hub.docker.com/v2/repositories/hyperledger/fabric-peer/tags?name=2.5.15
  - https://hub.docker.com/v2/repositories/hyperledger/fabric-ca/tags

---

## 1. test-network compose: peer + orderer env-var sets (VERIFIED)

Source: https://raw.githubusercontent.com/hyperledger/fabric-samples/c9b221e4a940da386cfadc3498a88085298d44be/test-network/compose/compose-test-net.yaml

### Peer container (peer0.org1, complete env block)

```yaml
peer0.org1.example.com:
  container_name: peer0.org1.example.com
  image: hyperledger/fabric-peer:latest        # GLEIPNIR: pin :2.5.15
  labels:
    service: hyperledger-fabric
  environment:
    - FABRIC_CFG_PATH=/etc/hyperledger/peercfg
    - FABRIC_LOGGING_SPEC=INFO
    - CORE_PEER_TLS_ENABLED=true
    - CORE_PEER_PROFILE_ENABLED=false
    - CORE_PEER_TLS_CERT_FILE=/etc/hyperledger/fabric/tls/server.crt
    - CORE_PEER_TLS_KEY_FILE=/etc/hyperledger/fabric/tls/server.key
    - CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/fabric/tls/ca.crt
    # Peer specific variables
    - CORE_PEER_ID=peer0.org1.example.com
    - CORE_PEER_ADDRESS=peer0.org1.example.com:7051
    - CORE_PEER_LISTENADDRESS=0.0.0.0:7051
    - CORE_PEER_CHAINCODEADDRESS=peer0.org1.example.com:7052
    - CORE_PEER_CHAINCODELISTENADDRESS=0.0.0.0:7052
    - CORE_PEER_GOSSIP_BOOTSTRAP=peer0.org1.example.com:7051
    - CORE_PEER_GOSSIP_EXTERNALENDPOINT=peer0.org1.example.com:7051
    - CORE_PEER_LOCALMSPID=Org1MSP
    - CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/msp
    - CORE_OPERATIONS_LISTENADDRESS=peer0.org1.example.com:9444
    - CORE_METRICS_PROVIDER=prometheus
    - CHAINCODE_AS_A_SERVICE_BUILDER_CONFIG={"peername":"peer0org1"}
    - CORE_CHAINCODE_EXECUTETIMEOUT=300s
  volumes:
    - ../organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com:/etc/hyperledger/fabric
    - peer0.org1.example.com:/var/hyperledger/production
  working_dir: /root
  command: peer node start
  ports:
    - 7051:7051
    - 9444:9444
```

peer0.org2 is identical except: `CORE_PEER_ID/ADDRESS=peer0.org2.example.com:9051`,
`LISTENADDRESS=0.0.0.0:9051`, `CHAINCODEADDRESS=...:9052`, `CHAINCODELISTENADDRESS=0.0.0.0:9052`,
gossip bootstrap/externalendpoint `peer0.org2.example.com:9051`, `LOCALMSPID=Org2MSP`,
`CORE_OPERATIONS_LISTENADDRESS=peer0.org2.example.com:9445`,
`CHAINCODE_AS_A_SERVICE_BUILDER_CONFIG={"peername":"peer0org2"}`, ports `9051:9051`, `9445:9445`.

Key mappings to copy:
- The whole per-peer crypto dir (`.../peers/peer0.org1.example.com` containing `msp/` and `tls/`)
  is mounted at **`/etc/hyperledger/fabric`**, so MSP path is `/etc/hyperledger/fabric/msp` and TLS
  files are `tls/server.crt|server.key|ca.crt` under it.
- Ledger + GoLevelDB state live in the **named volume** mounted at **`/var/hyperledger/production`**
  (this is exactly the stable `du` path GLEIPNIR's metrics contract requires).
- `FABRIC_CFG_PATH=/etc/hyperledger/peercfg` — the `core.yaml` comes from a **second compose file**
  (docker overlay), see below.

### Docker overlay file (adds docker socket + core.yaml mount)

`network.sh` always composes two files: `-f compose/compose-test-net.yaml -f compose/docker/docker-compose-test-net.yaml`.
Source: https://raw.githubusercontent.com/hyperledger/fabric-samples/c9b221e4a940da386cfadc3498a88085298d44be/test-network/compose/docker/docker-compose-test-net.yaml

```yaml
services:
  peer0.org1.example.com:
    environment:
      - CORE_VM_ENDPOINT=unix:///host/var/run/docker.sock
      - CORE_VM_DOCKER_HOSTCONFIG_NETWORKMODE=fabric_test
    volumes:
      - ./docker/peercfg:/etc/hyperledger/peercfg   # contains core.yaml (VERIFIED via API listing)
      - ${DOCKER_SOCK}:/host/var/run/docker.sock
```

`DOCKER_SOCK` is derived in `network.sh`:
```bash
SOCK="${DOCKER_HOST:-/var/run/docker.sock}"
DOCKER_SOCK="${SOCK##unix://}"
```
(https://raw.githubusercontent.com/hyperledger/fabric-samples/c9b221e4a940da386cfadc3498a88085298d44be/test-network/network.sh)

### Orderer container (complete env block)

```yaml
orderer.example.com:
  container_name: orderer.example.com
  image: hyperledger/fabric-orderer:latest     # GLEIPNIR: pin :2.5.15
  environment:
    - FABRIC_LOGGING_SPEC=INFO
    - ORDERER_GENERAL_LISTENADDRESS=0.0.0.0
    - ORDERER_GENERAL_LISTENPORT=7050
    - ORDERER_GENERAL_LOCALMSPID=OrdererMSP
    - ORDERER_GENERAL_LOCALMSPDIR=/var/hyperledger/orderer/msp
    # enabled TLS
    - ORDERER_GENERAL_TLS_ENABLED=true
    - ORDERER_GENERAL_TLS_PRIVATEKEY=/var/hyperledger/orderer/tls/server.key
    - ORDERER_GENERAL_TLS_CERTIFICATE=/var/hyperledger/orderer/tls/server.crt
    - ORDERER_GENERAL_TLS_ROOTCAS=[/var/hyperledger/orderer/tls/ca.crt]
    - ORDERER_GENERAL_CLUSTER_CLIENTCERTIFICATE=/var/hyperledger/orderer/tls/server.crt
    - ORDERER_GENERAL_CLUSTER_CLIENTPRIVATEKEY=/var/hyperledger/orderer/tls/server.key
    - ORDERER_GENERAL_CLUSTER_ROOTCAS=[/var/hyperledger/orderer/tls/ca.crt]
    - ORDERER_GENERAL_BOOTSTRAPMETHOD=none          # channel-participation flow, no bootstrap block
    - ORDERER_CHANNELPARTICIPATION_ENABLED=true
    - ORDERER_ADMIN_TLS_ENABLED=true
    - ORDERER_ADMIN_TLS_CERTIFICATE=/var/hyperledger/orderer/tls/server.crt
    - ORDERER_ADMIN_TLS_PRIVATEKEY=/var/hyperledger/orderer/tls/server.key
    - ORDERER_ADMIN_TLS_ROOTCAS=[/var/hyperledger/orderer/tls/ca.crt]
    - ORDERER_ADMIN_TLS_CLIENTROOTCAS=[/var/hyperledger/orderer/tls/ca.crt]   # mutual TLS for osnadmin
    - ORDERER_ADMIN_LISTENADDRESS=0.0.0.0:7053
    - ORDERER_OPERATIONS_LISTENADDRESS=orderer.example.com:9443
    - ORDERER_METRICS_PROVIDER=prometheus
  working_dir: /root
  command: orderer
  volumes:
    - ../organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp:/var/hyperledger/orderer/msp
    - ../organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/:/var/hyperledger/orderer/tls
    - orderer.example.com:/var/hyperledger/production/orderer
  ports:
    - 7050:7050
    - 7053:7053
    - 9443:9443
```

Note: the orderer has **no FABRIC_CFG_PATH override** — it uses the image's built-in
`/etc/hyperledger/fabric/orderer.yaml` and everything above is env-var overrides.

### Multi-orderer port layout (for GLEIPNIR's 3 Raft orderers)

The only in-repo multi-orderer compose is `compose-bft-test-net.yaml` (BFT/3.x — do NOT copy its
consensus config, but its **port scheme** is the reference for cloning orderer services):

| orderer | LISTENPORT | ADMIN_LISTENADDRESS | OPERATIONS |
|---|---|---|---|
| orderer.example.com  | 7050 | 0.0.0.0:7053 | 9443 |
| orderer2.example.com | 7052 | 0.0.0.0:7055 | 9446 |
| orderer3.example.com | 7056 | 0.0.0.0:7057 | 9447 |
| orderer4.example.com | 7058 | 0.0.0.0:7059 | 9448 |

Each gets its own named volume → `/var/hyperledger/production/orderer`.
Source: https://raw.githubusercontent.com/hyperledger/fabric-samples/c9b221e4a940da386cfadc3498a88085298d44be/test-network/compose/compose-bft-test-net.yaml
For a 2.5 Raft trio: use the orderer env block above verbatim per orderer (only ports/hostnames/volumes differ) and list all three as `EtcdRaft.Consenters` in configtx.yaml.

---

## 2. Fabric CA flow (VERIFIED)

### CA server containers

Source: https://raw.githubusercontent.com/hyperledger/fabric-samples/c9b221e4a940da386cfadc3498a88085298d44be/test-network/compose/compose-ca.yaml

```yaml
ca_org1:
  image: hyperledger/fabric-ca:latest          # GLEIPNIR: pin :1.5.19
  environment:
    - FABRIC_CA_HOME=/etc/hyperledger/fabric-ca-server
    - FABRIC_CA_SERVER_CA_NAME=ca-org1
    - FABRIC_CA_SERVER_TLS_ENABLED=true
    - FABRIC_CA_SERVER_PORT=7054
    - FABRIC_CA_SERVER_OPERATIONS_LISTENADDRESS=0.0.0.0:17054
  ports: ["7054:7054", "17054:17054"]
  command: sh -c 'fabric-ca-server start -b admin:adminpw -d'
  volumes:
    - ../organizations/fabric-ca/org1:/etc/hyperledger/fabric-ca-server
```
`ca_org2` = port 8054/18054, name `ca-org2`; `ca_orderer` = port 9054/19054, name `ca-orderer`.
The CA writes `ca-cert.pem` + `tls-cert.pem` into the mounted host dir; `network.sh` polls for
`organizations/fabric-ca/org1/tls-cert.pem` then `fabric-ca-client getcainfo` before enrolling.

### registerEnroll.sh — the exact peer-org sequence (createOrg1)

Source: https://raw.githubusercontent.com/hyperledger/fabric-samples/c9b221e4a940da386cfadc3498a88085298d44be/test-network/organizations/fabric-ca/registerEnroll.sh

```bash
export FABRIC_CA_CLIENT_HOME=${PWD}/organizations/peerOrganizations/org1.example.com/

# 1) enroll the CA (bootstrap) admin — creates the org-level MSP under $FABRIC_CA_CLIENT_HOME/msp
fabric-ca-client enroll -u https://admin:adminpw@localhost:7054 --caname ca-org1 \
  --tls.certfiles "${PWD}/organizations/fabric-ca/org1/ca-cert.pem"

# 2) NodeOUs config.yaml written to the ORG msp, then copied into every leaf MSP
echo 'NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: cacerts/localhost-7054-ca-org1.pem
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: cacerts/localhost-7054-ca-org1.pem
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: cacerts/localhost-7054-ca-org1.pem
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: cacerts/localhost-7054-ca-org1.pem
    OrganizationalUnitIdentifier: orderer' > "${PWD}/organizations/peerOrganizations/org1.example.com/msp/config.yaml"
# NOTE the cacerts filename is derived from the enroll URL: host-port-caname → localhost-7054-ca-org1.pem

# 3) one CA acts as both org CA and TLS CA — fan the root cert out:
#    msp/tlscacerts/ca.crt          (channel MSP definition)
#    tlsca/tlsca.org1.example.com-cert.pem   (clients; envVar.sh points here)
#    ca/ca.org1.example.com-cert.pem
cp .../fabric-ca/org1/ca-cert.pem .../org1.example.com/msp/tlscacerts/ca.crt
cp .../fabric-ca/org1/ca-cert.pem .../org1.example.com/tlsca/tlsca.org1.example.com-cert.pem
cp .../fabric-ca/org1/ca-cert.pem .../org1.example.com/ca/ca.org1.example.com-cert.pem

# 4) register the three identity types (id.type matters for NodeOUs)
fabric-ca-client register --caname ca-org1 --id.name peer0     --id.secret peer0pw     --id.type peer   --tls.certfiles ".../org1/ca-cert.pem"
fabric-ca-client register --caname ca-org1 --id.name user1     --id.secret user1pw     --id.type client --tls.certfiles ".../org1/ca-cert.pem"
fabric-ca-client register --caname ca-org1 --id.name org1admin --id.secret org1adminpw --id.type admin  --tls.certfiles ".../org1/ca-cert.pem"

# 5) enroll peer0's local MSP (-M targets the msp dir), then drop config.yaml into it
fabric-ca-client enroll -u https://peer0:peer0pw@localhost:7054 --caname ca-org1 \
  -M ".../peers/peer0.org1.example.com/msp" --tls.certfiles ".../org1/ca-cert.pem"
cp .../org1.example.com/msp/config.yaml .../peers/peer0.org1.example.com/msp/config.yaml

# 6) enroll peer0's TLS certs with the tls profile; --csr.hosts = SANs (container DNS name + localhost)
fabric-ca-client enroll -u https://peer0:peer0pw@localhost:7054 --caname ca-org1 \
  -M ".../peers/peer0.org1.example.com/tls" --enrollment.profile tls \
  --csr.hosts peer0.org1.example.com --csr.hosts localhost --tls.certfiles ".../org1/ca-cert.pem"

# 7) rename TLS material to the well-known names the peer env expects
cp .../tls/tlscacerts/* .../tls/ca.crt
cp .../tls/signcerts/*  .../tls/server.crt
cp .../tls/keystore/*   .../tls/server.key

# 8) enroll user + admin MSPs (same -M pattern, copy config.yaml into each)
fabric-ca-client enroll -u https://user1:user1pw@localhost:7054 ... -M ".../users/User1@org1.example.com/msp"
fabric-ca-client enroll -u https://org1admin:org1adminpw@localhost:7054 ... -M ".../users/Admin@org1.example.com/msp"
```

**Resulting local MSP layout** (what `-M` produces + the copies):
```
peers/peer0.org1.example.com/
├── msp/
│   ├── cacerts/localhost-7054-ca-org1.pem   # filename = <host>-<port>-<caname>.pem
│   ├── keystore/<hash>_sk                   # private key (random name; NodeOUs makes admincerts unnecessary)
│   ├── signcerts/cert.pem
│   └── config.yaml                          # NodeOUs block above
└── tls/
    ├── ca.crt  server.crt  server.key       # well-known names referenced by peer env
    └── (tlscacerts/ signcerts/ keystore/ originals)
```

**Orderer org differences** (createOrderer): registers with `--id.type orderer`; loops
`for ORDERER in orderer orderer2 orderer3 orderer4` (2.5/Raft only uses the first — GLEIPNIR would
loop its own three); renames the signcert
`msp/signcerts/cert.pem → ${ORDERER}.example.com-cert.pem` ("Workaround ... consistency with
Cryptogen"); additionally copies the TLS CA cert into each orderer's
`msp/tlscacerts/tlsca.example.com-cert.pem`; registers `ordererAdmin` with `--id.type admin` and
enrolls it to `users/Admin@example.com/msp`. Org-level cert fan-out goes to
`msp/tlscacerts/tlsca.example.com-cert.pem` and `tlsca/tlsca.example.com-cert.pem` (the file
`envVar.sh` exports as `ORDERER_CA`).

**AnchorClientMSP note for GLEIPNIR:** the anchor-client identity (§4.4 of ARCHITECTURE) is just
another `--id.type client` register + enroll against whichever CA owns it, with NodeOUs
`config.yaml` copied into its MSP — same 5-step pattern as `user1`.

---

## 3. Channel creation with channel participation (VERIFIED)

Sources:
- https://raw.githubusercontent.com/hyperledger/fabric-samples/c9b221e4a940da386cfadc3498a88085298d44be/test-network/scripts/createChannel.sh
- https://raw.githubusercontent.com/hyperledger/fabric-samples/c9b221e4a940da386cfadc3498a88085298d44be/test-network/scripts/orderer.sh
- https://raw.githubusercontent.com/hyperledger/fabric-samples/c9b221e4a940da386cfadc3498a88085298d44be/test-network/configtx/configtx.yaml

### Step 1 — configtxgen emits the app-channel genesis block

`FABRIC_CFG_PATH` must point at the **directory containing configtx.yaml** for this step:
```bash
FABRIC_CFG_PATH=${PWD}/configtx
configtxgen -profile ChannelUsingRaft -outputBlock ./channel-artifacts/${CHANNEL_NAME}.block -channelID $CHANNEL_NAME
```

The `ChannelUsingRaft` profile (trimmed; this is the whole no-system-channel pattern —
GLEIPNIR's "anchor channel" and per-case channels each get a profile shaped like this):
```yaml
Profiles:
  ChannelUsingRaft:
    <<: *ChannelDefaults
    Orderer:
      <<: *OrdererDefaults
      OrdererType: etcdraft
      EtcdRaft:
        Consenters:
          - Host: orderer.example.com
            Port: 7050
            ClientTLSCert: ../organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.crt
            ServerTLSCert: ../organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.crt
      Organizations: [ *OrdererOrg ]
      Capabilities: *OrdererCapabilities
    Application:
      <<: *ApplicationDefaults
      Organizations: [ *Org1, *Org2 ]
      Capabilities: *ApplicationCapabilities
```
Also relevant: `Capabilities.Application: V2_5: true`, `Channel/Orderer: V2_0: true`;
`BatchTimeout: 2s`, `BatchSize.MaxMessageCount: 10` (these are the knobs that dominate write
latency at low load — record them in the run manifest).

### Step 2 — osnadmin channel join, once per orderer

`scripts/orderer.sh` (env + command, exactly):
```bash
export ORDERER_ADMIN_TLS_SIGN_CERT=${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.crt
export ORDERER_ADMIN_TLS_PRIVATE_KEY=${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.key

osnadmin channel join --channelID ${channel_name} \
  --config-block ./channel-artifacts/${channel_name}.block \
  -o localhost:7053 \
  --ca-file "$ORDERER_CA" \
  --client-cert "$ORDERER_ADMIN_TLS_SIGN_CERT" \
  --client-key "$ORDERER_ADMIN_TLS_PRIVATE_KEY"
```
`$ORDERER_CA` comes from `envVar.sh` =
`organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem`.
`osnadmin` speaks **mutual TLS** to `ORDERER_ADMIN_LISTENADDRESS` (7053) — the client cert/key here
are the orderer's own TLS pair, accepted because of `ORDERER_ADMIN_TLS_CLIENTROOTCAS`.
For multiple orderers the sample simply repeats this per orderer with the next admin port
(`orderer2.sh` → `-o localhost:7055`, cert paths under `orderers/orderer2.example.com/tls/`) —
GLEIPNIR's `provision-channel.sh` should loop {7053,7055,7057} and assert HTTP 201 per join.
`createChannel.sh` wraps the join in a retry loop (`MAX_RETRY=5`, `DELAY=3`) because the Raft
leader may not be elected yet.

### Step 3 — peer channel join (per org)

`FABRIC_CFG_PATH` switches to the **peer CLI config dir** (`../config`, the sampleconfig
`core.yaml` shipped with the binaries) and org context is set via `setGlobals`:
```bash
joinChannel() {
  ORG=$1
  FABRIC_CFG_PATH=$PWD/../config/
  setGlobals $ORG                              # sets CORE_PEER_* for that org (see §5)
  peer channel join -b ./channel-artifacts/${CHANNEL_NAME}.block   # retried MAX_RETRY times
}
```
Then anchor peers are set per org via `scripts/setAnchorPeer.sh` (config update flow; runs in the
CLI context with `docker exec cli ./scripts/setAnchorPeer.sh $ORG $CHANNEL_NAME` in the sample).

**Env summary per step (inside a fabric-tools container these are the same, only paths differ):**
| Step | Needs |
|---|---|
| configtxgen | `FABRIC_CFG_PATH=<dir with configtx.yaml>`; the MSP dirs referenced by `MSPDir` must exist |
| osnadmin join | `ORDERER_CA` (orderer TLS CA), orderer admin TLS client cert+key, reachability of admin port |
| peer channel join | `FABRIC_CFG_PATH=<dir with core.yaml>`, `CORE_PEER_TLS_ENABLED=true`, `CORE_PEER_LOCALMSPID`, `CORE_PEER_MSPCONFIGPATH` (org **Admin** MSP), `CORE_PEER_TLS_ROOTCERT_FILE`, `CORE_PEER_ADDRESS` |

---

## 4. deployCCAAS.sh — chaincode-as-a-service lifecycle (VERIFIED)

Sources:
- https://raw.githubusercontent.com/hyperledger/fabric-samples/c9b221e4a940da386cfadc3498a88085298d44be/test-network/scripts/deployCCAAS.sh
- https://raw.githubusercontent.com/hyperledger/fabric-samples/c9b221e4a940da386cfadc3498a88085298d44be/test-network/scripts/ccutils.sh
- https://raw.githubusercontent.com/hyperledger/fabric-samples/c9b221e4a940da386cfadc3498a88085298d44be/test-network/CHAINCODE_AS_A_SERVICE_TUTORIAL.md

### 4.1 Package = connection.json + metadata.json, double-tarred

```bash
CCAAS_SERVER_PORT=9999
address="{{.peername}}_${CC_NAME}_ccaas:${CCAAS_SERVER_PORT}"   # Go-template, resolved per-peer
label=${CC_NAME}_${CC_VERSION}

# src/connection.json
{
  "address": "${address}",
  "dial_timeout": "10s",
  "tls_required": false
}
# pkg/metadata.json
{
    "type": "ccaas",
    "label": "$label"
}

tar -C "$tempdir/src" -czf "$tempdir/pkg/code.tar.gz" .
tar -C "$tempdir/pkg" -czf "$CC_NAME.tar.gz" metadata.json code.tar.gz

PACKAGE_ID=$(peer lifecycle chaincode calculatepackageid ${CC_NAME}.tar.gz)
```
The `{{.peername}}` template is resolved by the **`ccaasbuilder` external builder that is
preconfigured inside the `hyperledger/fabric-peer` image** (tutorial line: "The docker image for
the peer contains a builder for chaincode-as-a-service preconfigured. This is named
'ccaasbuilder'"), using the peer's env var
`CHAINCODE_AS_A_SERVICE_BUILDER_CONFIG={"peername":"peer0org1"}` →
address becomes `peer0org1_<ccname>_ccaas:9999`. This is why the same package installs on both
peers yet each dials its own chaincode container.

### 4.2 Lifecycle sequence (exact commands from ccutils.sh)

```bash
# install on every peer (idempotent: checks queryinstalled first)
setGlobals 1;  peer lifecycle chaincode install ${CC_NAME}.tar.gz
setGlobals 2;  peer lifecycle chaincode install ${CC_NAME}.tar.gz

# verify
peer lifecycle chaincode queryinstalled --output json | jq -r 'try (.installed_chaincodes[].package_id)' | grep ^${PACKAGE_ID}$

# approve per org — note --package-id and the optional signature policy
# (deployCCAAS.sh sets CC_END_POLICY="--signature-policy $CC_END_POLICY" when the -ccep flag is given)
peer lifecycle chaincode approveformyorg -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com --tls --cafile "$ORDERER_CA" \
  --channelID $CHANNEL_NAME --name ${CC_NAME} --version ${CC_VERSION} \
  --package-id ${PACKAGE_ID} --sequence ${CC_SEQUENCE} ${INIT_REQUIRED} ${CC_END_POLICY} ${CC_COLL_CONFIG}

# readiness — asserted per org against the JSON output
peer lifecycle chaincode checkcommitreadiness --channelID $CHANNEL_NAME --name ${CC_NAME} \
  --version ${CC_VERSION} --sequence ${CC_SEQUENCE} ${INIT_REQUIRED} ${CC_END_POLICY} ${CC_COLL_CONFIG} --output json
# deployCCAAS.sh asserts: '"Org1MSP": true' '"Org2MSP": false' after org1's approval, then both true

# commit — targets BOTH peers with --peerAddresses/--tlsRootCertFiles pairs
peer lifecycle chaincode commit -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com --tls --cafile "$ORDERER_CA" \
  --channelID $CHANNEL_NAME --name ${CC_NAME} \
  --peerAddresses localhost:7051 --tlsRootCertFiles "$PEER0_ORG1_CA" \
  --peerAddresses localhost:9051 --tlsRootCertFiles "$PEER0_ORG2_CA" \
  --version ${CC_VERSION} --sequence ${CC_SEQUENCE} ${INIT_REQUIRED} ${CC_END_POLICY} ${CC_COLL_CONFIG}

peer lifecycle chaincode querycommitted --channelID $CHANNEL_NAME --name ${CC_NAME}
```
(The `--peerAddresses ... --tlsRootCertFiles ...` pairs are built by
`parsePeerConnectionParameters` in envVar.sh — see §5.)
`resolveSequence` supports `CC_SEQUENCE=auto`: reads committed sequence via `querycommitted`,
approved via `queryapproved`, and increments — useful verbatim for GLEIPNIR's per-case
re-provisioning.

### 4.3 Starting the chaincode server container

Order matters: the sample **commits the definition first, then starts the containers** (the peer
only dials the ccaas address at invoke time). Exact `docker run` (one per peer, on the same
compose network):
```bash
docker build -f $CC_SRC_PATH/Dockerfile -t ${CC_NAME}_ccaas_image:latest --build-arg CC_SERVER_PORT=9999 $CC_SRC_PATH

docker run --rm -d --name peer0org1_${CC_NAME}_ccaas \
  --network fabric_test \
  -e CHAINCODE_SERVER_ADDRESS=0.0.0.0:${CCAAS_SERVER_PORT} \
  -e CHAINCODE_ID=$PACKAGE_ID -e CORE_CHAINCODE_ID_NAME=$PACKAGE_ID \
  ${CC_NAME}_ccaas_image:latest
# and identically: --name peer0org2_${CC_NAME}_ccaas
```
- Container **name must equal the resolved connection.json address host**
  (`<peername>_<ccname>_ccaas`).
- `CHAINCODE_SERVER_ADDRESS` + `CHAINCODE_ID` are what the Go/Node contract libraries read;
  `CORE_CHAINCODE_ID_NAME` is set too for the Java library ("The two key variables that are needed
  are the CHAINCODE_SERVER_ADDRESS and CORE_CHAICODE_ID_NAME" — tutorial).
- For Node.js chaincode the start command changes to
  `fabric-chaincode-node server --chaincode-address=$CHAINCODE_SERVER_ADDRESS --chaincode-id=$CHAINCODE_ID`.
- `tls_required: false` in connection.json — peer↔chaincode TLS is off in the sample; keep it off
  for GLEIPNIR (single host, measured component boundaries unchanged across variants).

**GLEIPNIR relevance:** CCAAS eliminates the peer-managed docker-build step (and the docker.sock
mount, if you run ALL chaincode as ccaas), which makes the chaincode container an explicit,
name-addressable compose service — that fits the "each component is its own Docker service" STRIDE
mapping. The alternative (classic `deployCC.sh` with the Go builder) needs
`CORE_VM_ENDPOINT=unix:///host/var/run/docker.sock` on the peers as in §1.

---

## 5. CLI/tools container pattern + setGlobals org-switching (VERIFIED)

### 5.1 What main's test-network actually does (host-run CLI)

On `main` the test-network **no longer runs a `cli` container for the lifecycle scripts** — all
`peer`/`configtxgen`/`osnadmin` commands run **on the host** using the downloaded binaries
(`export PATH=${ROOTDIR}/../bin:$PATH`, `FABRIC_CFG_PATH=$PWD/../config` — network.sh lines 21–22
and createChannel.sh line 75), talking to `localhost:7051 / 9051 / 7050 / 7053`. That is why every
address in scripts is `localhost:*` and works only with published ports.

The org-switching idiom, `scripts/envVar.sh` (copy verbatim, this is the exact contract):
```bash
export CORE_PEER_TLS_ENABLED=true
export ORDERER_CA=${TEST_NETWORK_HOME}/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem
export PEER0_ORG1_CA=${TEST_NETWORK_HOME}/organizations/peerOrganizations/org1.example.com/tlsca/tlsca.org1.example.com-cert.pem
export PEER0_ORG2_CA=${TEST_NETWORK_HOME}/organizations/peerOrganizations/org2.example.com/tlsca/tlsca.org2.example.com-cert.pem

setGlobals() {
  local USING_ORG=${OVERRIDE_ORG:-$1}
  if [ $USING_ORG -eq 1 ]; then
    export CORE_PEER_LOCALMSPID=Org1MSP
    export CORE_PEER_TLS_ROOTCERT_FILE=$PEER0_ORG1_CA
    export CORE_PEER_MSPCONFIGPATH=${TEST_NETWORK_HOME}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
    export CORE_PEER_ADDRESS=localhost:7051
  elif [ $USING_ORG -eq 2 ]; then
    export CORE_PEER_LOCALMSPID=Org2MSP
    export CORE_PEER_TLS_ROOTCERT_FILE=$PEER0_ORG2_CA
    export CORE_PEER_MSPCONFIGPATH=${TEST_NETWORK_HOME}/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp
    export CORE_PEER_ADDRESS=localhost:9051
  fi
}

parsePeerConnectionParameters() {   # builds --peerAddresses X --tlsRootCertFiles Y pairs
  PEER_CONN_PARMS=()
  while [ "$#" -gt 0 ]; do
    setGlobals $1
    PEER_CONN_PARMS=("${PEER_CONN_PARMS[@]}" --peerAddresses $CORE_PEER_ADDRESS)
    CA=PEER0_ORG$1_CA
    PEER_CONN_PARMS=("${PEER_CONN_PARMS[@]}" --tlsRootCertFiles "${!CA}")
    shift
  done
}
```
Source: https://raw.githubusercontent.com/hyperledger/fabric-samples/c9b221e4a940da386cfadc3498a88085298d44be/test-network/scripts/envVar.sh

### 5.2 The containerized cli pattern (release-2.2 test-network — the last in-tree version)

GLEIPNIR's architecture (§3) wants a `cli`/tools **container**. The canonical fabric-samples shape
for it is in the release-2.2 test-network compose:

```yaml
cli:
  container_name: cli
  image: hyperledger/fabric-tools:latest       # GLEIPNIR: pin :2.5.15 (tag VERIFIED on Docker Hub)
  tty: true
  stdin_open: true
  environment:
    - GOPATH=/opt/gopath
    - CORE_VM_ENDPOINT=unix:///host/var/run/docker.sock
    - FABRIC_LOGGING_SPEC=INFO
  working_dir: /opt/gopath/src/github.com/hyperledger/fabric/peer
  command: /bin/bash
  volumes:
    - /var/run/:/host/var/run/
    - ../organizations:/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations
    - ../scripts:/opt/gopath/src/github.com/hyperledger/fabric/peer/scripts/
  depends_on:
    - peer0.org1.example.com
    - peer0.org2.example.com
  networks: [ test ]
```
Source: https://raw.githubusercontent.com/hyperledger/fabric-samples/release-2.2/test-network/docker/docker-compose-test-net.yaml

Adaptation rules when moving the §3/§4/§5 commands into this container (all follow directly from
the two sources above):
1. The `fabric-tools` image ships `peer`, `configtxgen`, `osnadmin` and a default
   `FABRIC_CFG_PATH=/etc/hyperledger/fabric` with sampleconfig; for configtxgen mount your
   `configtx/` and set `FABRIC_CFG_PATH` to it per-invocation, exactly as createChannel.sh flips it.
2. Replace every `localhost:PORT` with the compose-DNS name:
   `CORE_PEER_ADDRESS=peer0.org1.example.com:7051`, `-o orderer.example.com:7050`,
   `osnadmin ... -o orderer.example.com:7053` (then `--ordererTLSHostnameOverride` is unnecessary).
   The TLS certs already carry those SANs because registerEnroll.sh enrolls with
   `--csr.hosts peer0.org1.example.com` / `--csr.hosts localhost` (§2 step 6).
3. Mount `organizations/` at a fixed path and set `TEST_NETWORK_HOME` (envVar.sh honors it:
   `TEST_NETWORK_HOME=${TEST_NETWORK_HOME:-${PWD}}`) so `setGlobals` works unmodified inside the
   container.
4. `setGlobals N` before every peer command is the entire org-context contract:
   `CORE_PEER_LOCALMSPID` + `CORE_PEER_MSPCONFIGPATH` (Admin MSP!) + `CORE_PEER_TLS_ROOTCERT_FILE`
   + `CORE_PEER_ADDRESS`, with `CORE_PEER_TLS_ENABLED=true` exported once.

---

## Verification ledger

| Item | Status | Source |
|---|---|---|
| No `release-2.5` branch; tags end v2.4.9; `main` is the 2.5 samples line | VERIFIED | GitHub API branches/tags endpoints + install-fabric.sh (fabric `release-2.5`) fallback-to-main logic |
| Peer env block (CORE_PEER_ID/ADDRESS/LISTENADDRESS/CHAINCODEADDRESS/CHAINCODELISTENADDRESS/GOSSIP_*/LOCALMSPID/MSPCONFIGPATH/TLS_*, FABRIC_CFG_PATH, operations+metrics, named volume at /var/hyperledger/production) | VERIFIED | raw compose-test-net.yaml @ c9b221e |
| Orderer env block (LISTENADDRESS/LISTENPORT, LOCALMSPID/LOCALMSPDIR, TLS+CLUSTER vars, BOOTSTRAPMETHOD=none, CHANNELPARTICIPATION_ENABLED=true, ADMIN_TLS_* incl. CLIENTROOTCAS, ADMIN_LISTENADDRESS 0.0.0.0:7053, operations 9443 + prometheus) | VERIFIED | raw compose-test-net.yaml @ c9b221e |
| Docker overlay: CORE_VM_ENDPOINT, CORE_VM_DOCKER_HOSTCONFIG_NETWORKMODE=fabric_test, peercfg mount (contains core.yaml), DOCKER_SOCK derivation | VERIFIED | raw docker-compose-test-net.yaml + network.sh + GitHub contents API for compose/docker/peercfg |
| fabric-ca-server env + `-b admin:adminpw -d` command; register/enroll sequence; NodeOUs config.yaml; TLS profile + --csr.hosts; server.crt/server.key/ca.crt renames; tlsca/ca fan-out; orderer signcert rename | VERIFIED | raw compose-ca.yaml + registerEnroll.sh @ c9b221e |
| configtxgen `ChannelUsingRaft` → osnadmin join (mutual TLS, admin port) → peer channel join; FABRIC_CFG_PATH flip between configtx/ and ../config | VERIFIED | raw createChannel.sh, orderer.sh, orderer2.sh, configtx.yaml @ c9b221e |
| CCAAS package format, calculatepackageid, approveformyorg --package-id, --signature-policy plumbing, checkcommitreadiness assertions, commit with --peerAddresses/--tlsRootCertFiles, docker run env (CHAINCODE_SERVER_ADDRESS/CHAINCODE_ID/CORE_CHAINCODE_ID_NAME), {{.peername}} builder template, ccaasbuilder preinstalled in peer image | VERIFIED | raw deployCCAAS.sh, ccutils.sh, CHAINCODE_AS_A_SERVICE_TUTORIAL.md @ c9b221e |
| setGlobals/envVar.sh idiom + parsePeerConnectionParameters | VERIFIED | raw envVar.sh @ c9b221e |
| cli container (fabric-tools, mounts, working_dir) | VERIFIED (release-2.2 branch — pattern absent from main's test-network, which runs CLI on the host) | raw docker-compose-test-net.yaml @ release-2.2 |
| Image tags fabric-peer:2.5.15, fabric-tools:2.5.15, fabric-ca:1.5.19 exist | VERIFIED | Docker Hub v2 tags API |
| Multi-orderer admin-port layout (7053/7055/7057/7059) | VERIFIED, but taken from the BFT compose (Fabric 3.x consensus) — only the port/env cloning pattern applies to a 2.5 Raft trio, not the consensus config | raw compose-bft-test-net.yaml @ c9b221e |

Unverified items: none — every claim above was checked against a fetched primary source. One
judgment call (not a fact claim): reusing the BFT compose's port scheme for GLEIPNIR's 3 Raft
orderers is an adaptation, since fabric-samples `main` contains no multi-orderer **Raft** compose.
