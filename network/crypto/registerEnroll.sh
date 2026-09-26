#!/usr/bin/env bash
#
# GLEIPNIR crypto material via Fabric CA 1.5.19 enrollment (no cryptogen).
# Produces network/organizations/{peerOrganizations,ordererOrganizations}/... in
# the standard Fabric layout with NodeOUs, for FOUR orgs:
#   org1  (Org1MSP)          peer0 + admin + User1
#   org2  (Org2MSP)          peer0 + admin + User1
#   orderer org (OrdererMSP) orderer0/1/2 + admin
#   anchor (AnchorClientMSP) peer0 + admin + the fixed client id 'anchorclient'
# The anchor org is only enrolled when ENABLE_ANCHOR_ORG=true (Parallel-Anchored).
#
# Prereq: `fabric-ca-client` (v1.5.x) on PATH and the four CAs already running
# (network/compose/compose-ca.yaml). Follows the fabric-samples registerEnroll
# idiom (docs/research/fabric-samples-patterns.md §2).
#
# Idempotent-ish: re-enrolling overwrites; delete network/organizations to reset.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NET_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ORG_DIR="${NET_DIR}/organizations"
FABRIC_CA_DIR="${ORG_DIR}/fabric-ca"
ENABLE_ANCHOR_ORG="${ENABLE_ANCHOR_ORG:-false}"

# CA endpoints (host ports per docs/CONTRACTS.md §1).
CA_ORG1_PORT=7054
CA_ORG2_PORT=8054
CA_ANCHOR_PORT=9054
CA_ORDERER_PORT=10054
CA_HOST="${CA_HOST:-localhost}"

# NodeOU config.yaml written into every org/node MSP so peer/orderer/admin/client
# OUs are derived from the CA cert. <CANAME> is substituted per MSP.
write_nodeou_config() {
  local msp_dir="$1" ca_cert_name="$2"
  cat > "${msp_dir}/config.yaml" <<EOF
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: cacerts/${ca_cert_name}
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: cacerts/${ca_cert_name}
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: cacerts/${ca_cert_name}
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: cacerts/${ca_cert_name}
    OrganizationalUnitIdentifier: orderer
EOF
}

# Fabric CA writes the enrolled private key under keystore/ with a hash-based
# name. Client tooling that needs a stable path (Caliper network configs) reads
# keystore/priv_sk, so copy the key to that fixed name for CLIENT identities only.
# (Peer/orderer MSP keystores are left untouched — their loaders expect one key.)
normalize_client_key() {
  local msp="$1" key
  # Re-enrollment ADDS a new hash-named key beside the old one(s); the stale
  # priv_sk copy and alphabetical order both mislead. Remove the old copy and
  # pair the NEWEST real key with the (overwritten) cert (audit F47).
  rm -f "${msp}/keystore/priv_sk"
  key="$(ls -t "${msp}/keystore/" | head -1)"
  cp "${msp}/keystore/${key}" "${msp}/keystore/priv_sk"
}

# fabric-ca-client against one CA: `caname` is the caller's local (bash dynamic
# scope — every call runs inside create_peer_org / create_orderer_org).
fcc() {
  fabric-ca-client "$@" --caname "${caname}" --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"
}

# enroll_ca_admin <ca-name> <port> <ca-home> : enroll the bootstrap admin so we
# can register identities against this CA.
enroll_ca_admin() {
  local caname="$1" port="$2" ca_home="$3"
  export FABRIC_CA_CLIENT_HOME="${ca_home}"
  fcc enroll -u "https://admin:adminpw@${CA_HOST}:${port}"
}

# enroll_node <id> <secret> <host> <node-dir> : a peer's / orderer's MSP + TLS
# enrollment (against the caller's caname/caport), TLS material normalised to the
# conventional filenames.
enroll_node() {
  fcc enroll -u "https://$1:$2@${CA_HOST}:${caport}" -M "$4/msp" --csr.hosts "$3,localhost"
  fcc enroll -u "https://$1:$2@${CA_HOST}:${caport}" -M "$4/tls" --enrollment.profile tls --csr.hosts "$3,localhost"
  cp "$4/tls/tlscacerts/"* "$4/tls/ca.crt"
  cp "$4/tls/signcerts/"*   "$4/tls/server.crt"
  cp "$4/tls/keystore/"*    "$4/tls/server.key"
}

# ---------------------------------------------------------------------------
# Peer organisation: org1 / org2 / anchor
# args: <org-shortname> <MSPID> <ca-name> <ca-port> <peer-host> [extra-client-id]
# ---------------------------------------------------------------------------
create_peer_org() {
  local org="$1" mspid="$2" caname="$3" caport="$4" peerhost="$5" extra_client="${6:-}"
  local domain="${org}.example.com"
  local org_root="${ORG_DIR}/peerOrganizations/${domain}"
  mkdir -p "${org_root}"

  echo "==> [${org}] enrolling CA admin"
  enroll_ca_admin "${caname}" "${caport}" "${org_root}"

  echo "==> [${org}] registering identities"
  fcc register --id.name "${org}-peer0" --id.secret peer0pw --id.type peer
  fcc register --id.name "${org}-admin" --id.secret adminpw --id.type admin
  fcc register --id.name "${org}-user1" --id.secret user1pw --id.type client
  if [ -n "${extra_client}" ]; then
    fcc register --id.name "${extra_client}" --id.secret "${extra_client}pw" --id.type client
  fi

  # --- org-level MSP (used by configtx) ---
  mkdir -p "${org_root}/msp"

  # --- peer0 MSP + TLS ---
  local peer_dir="${org_root}/peers/${peerhost}"
  enroll_node "${org}-peer0" peer0pw "${peerhost}" "${peer_dir}"

  # Derive the org MSP and cacert name from the peer MSP. The CA-admin
  # enrollment above already created ${org_root}/msp/cacerts, so the pem must
  # be copied flat: `cp -r` would nest a second cacerts/ inside it and the
  # two `ls` entries then corrupt every NodeOU config.yaml with an embedded
  # newline — peers fail YAML parsing, orderers panic in loadLocalMSP
  # (audit F72, first live bring-up).
  mkdir -p "${org_root}/msp/cacerts"
  cp "${peer_dir}/msp/cacerts/"* "${org_root}/msp/cacerts/"
  mkdir -p "${org_root}/msp/tlscacerts"
  cp "${peer_dir}/tls/tlscacerts/"* "${org_root}/msp/tlscacerts/ca.crt"
  local cacert_name
  cacert_name="$(ls "${org_root}/msp/cacerts")"
  write_nodeou_config "${org_root}/msp" "${cacert_name}"
  cp "${org_root}/msp/config.yaml" "${peer_dir}/msp/config.yaml"

  # --- admin + User1 ---
  fcc enroll -u "https://${org}-admin:adminpw@${CA_HOST}:${caport}" -M "${org_root}/users/Admin@${domain}/msp"
  cp "${org_root}/msp/config.yaml" "${org_root}/users/Admin@${domain}/msp/config.yaml"

  fcc enroll -u "https://${org}-user1:user1pw@${CA_HOST}:${caport}" -M "${org_root}/users/User1@${domain}/msp"
  cp "${org_root}/msp/config.yaml" "${org_root}/users/User1@${domain}/msp/config.yaml"
  normalize_client_key "${org_root}/users/User1@${domain}/msp"

  # Fixed anchor-client identity (only for the anchor org).
  if [ -n "${extra_client}" ]; then
    fcc enroll -u "https://${extra_client}:${extra_client}pw@${CA_HOST}:${caport}" \
      -M "${org_root}/users/${extra_client}@${domain}/msp"
    cp "${org_root}/msp/config.yaml" "${org_root}/users/${extra_client}@${domain}/msp/config.yaml"
    normalize_client_key "${org_root}/users/${extra_client}@${domain}/msp"
  fi
  echo "==> [${org}] done (${mspid})"
}

# ---------------------------------------------------------------------------
# Orderer organisation: 3 orderers + admin
# ---------------------------------------------------------------------------
create_orderer_org() {
  local caname="ca-orderer" caport="${CA_ORDERER_PORT}"
  local domain="example.com"
  local org_root="${ORG_DIR}/ordererOrganizations/${domain}"
  mkdir -p "${org_root}"

  echo "==> [orderer] enrolling CA admin"
  enroll_ca_admin "${caname}" "${caport}" "${org_root}"

  echo "==> [orderer] registering identities"
  for i in 0 1 2; do
    fcc register --id.name "orderer${i}" --id.secret "orderer${i}pw" --id.type orderer
  done
  fcc register --id.name "orderer-admin" --id.secret adminpw --id.type admin

  mkdir -p "${org_root}/msp/tlscacerts"

  for i in 0 1 2; do
    local host="orderer${i}.example.com"
    local odir="${org_root}/orderers/${host}"
    enroll_node "orderer${i}" "orderer${i}pw" "${host}" "${odir}"

    if [ "${i}" = "0" ]; then
      # Flat copy for the same reason as create_peer_org (audit F72).
      mkdir -p "${org_root}/msp/cacerts"
      cp "${odir}/msp/cacerts/"* "${org_root}/msp/cacerts/"
      cp "${odir}/tls/tlscacerts/"* "${org_root}/msp/tlscacerts/tlsca.example.com-cert.pem"
      local cacert_name
      cacert_name="$(ls "${org_root}/msp/cacerts")"
      write_nodeou_config "${org_root}/msp" "${cacert_name}"
    fi
    cp "${org_root}/msp/config.yaml" "${odir}/msp/config.yaml"
  done

  fcc enroll -u "https://orderer-admin:adminpw@${CA_HOST}:${caport}" -M "${org_root}/users/Admin@${domain}/msp"
  cp "${org_root}/msp/config.yaml" "${org_root}/users/Admin@${domain}/msp/config.yaml"
  echo "==> [orderer] done (OrdererMSP)"
}

main() {
  mkdir -p "${ORG_DIR}"
  if [ "${1:-}" = "anchor-only" ]; then
    # up.sh --skip-crypto on Parallel-Anchored when the rest of the crypto exists but the
    # anchor org was never enrolled (the stack was first brought up as another variant).
    create_peer_org anchor AnchorClientMSP ca-anchor "${CA_ANCHOR_PORT}" peer0.anchor.example.com anchorclient
    echo "Anchor-org crypto generated under ${ORG_DIR} (other orgs untouched)"
    return
  fi
  create_orderer_org
  create_peer_org org1 Org1MSP ca-org1 "${CA_ORG1_PORT}" peer0.org1.example.com
  create_peer_org org2 Org2MSP ca-org2 "${CA_ORG2_PORT}" peer0.org2.example.com
  if [ "${ENABLE_ANCHOR_ORG}" = "true" ]; then
    create_peer_org anchor AnchorClientMSP ca-anchor "${CA_ANCHOR_PORT}" peer0.anchor.example.com anchorclient
  else
    echo "==> [anchor] skipped (ENABLE_ANCHOR_ORG != true)"
  fi
  echo "All crypto material generated under ${ORG_DIR}"
}

main "$@"
