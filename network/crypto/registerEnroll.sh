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
  key="$(ls "${msp}/keystore/" | head -1)"
  cp "${msp}/keystore/${key}" "${msp}/keystore/priv_sk"
}

# enroll_ca_admin <ca-name> <port> <ca-home> : enroll the bootstrap admin so we
# can register identities against this CA.
enroll_ca_admin() {
  local ca_name="$1" port="$2" ca_home="$3"
  export FABRIC_CA_CLIENT_HOME="${ca_home}"
  fabric-ca-client enroll -u "https://admin:adminpw@${CA_HOST}:${port}" \
    --caname "${ca_name}" \
    --tls.certfiles "${FABRIC_CA_DIR}/${ca_name}/tls-cert.pem"
}

# ---------------------------------------------------------------------------
# Peer organisation: org1 / org2 / anchor
# args: <org-shortname> <MSPID> <ca-name> <ca-port> <peer-host> [extra-client-id]
# ---------------------------------------------------------------------------
create_peer_org() {
  local org="$1" mspid="$2" caname="$3" caport="$4" peerhost="$5" extra_client="${6:-}"
  local domain="${org}.example.com"
  local org_root="${ORG_DIR}/peerOrganizations/${domain}"
  local ca_home="${org_root}"
  local ca_cert_file
  mkdir -p "${org_root}"

  echo "==> [${org}] enrolling CA admin"
  enroll_ca_admin "${caname}" "${caport}" "${ca_home}"

  echo "==> [${org}] registering identities"
  fabric-ca-client register --caname "${caname}" --id.name "${org}-peer0" --id.secret peer0pw --id.type peer \
    --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"
  fabric-ca-client register --caname "${caname}" --id.name "${org}-admin" --id.secret adminpw --id.type admin \
    --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"
  fabric-ca-client register --caname "${caname}" --id.name "${org}-user1" --id.secret user1pw --id.type client \
    --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"
  if [ -n "${extra_client}" ]; then
    fabric-ca-client register --caname "${caname}" --id.name "${extra_client}" --id.secret "${extra_client}pw" --id.type client \
      --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"
  fi

  # --- org-level MSP (used by configtx) ---
  mkdir -p "${org_root}/msp"
  ca_cert_file="ca-${CA_HOST}-${caport}.pem" # ignored; we copy the real cacert below

  # --- peer0 MSP + TLS ---
  local peer_dir="${org_root}/peers/${peerhost}"
  export FABRIC_CA_CLIENT_HOME="${org_root}"
  fabric-ca-client enroll -u "https://${org}-peer0:peer0pw@${CA_HOST}:${caport}" --caname "${caname}" \
    -M "${peer_dir}/msp" --csr.hosts "${peerhost},localhost" \
    --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"
  fabric-ca-client enroll -u "https://${org}-peer0:peer0pw@${CA_HOST}:${caport}" --caname "${caname}" \
    -M "${peer_dir}/tls" --enrollment.profile tls --csr.hosts "${peerhost},localhost" \
    --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"

  # Normalise TLS material to the conventional filenames.
  cp "${peer_dir}/tls/tlscacerts/"* "${peer_dir}/tls/ca.crt"
  cp "${peer_dir}/tls/signcerts/"*   "${peer_dir}/tls/server.crt"
  cp "${peer_dir}/tls/keystore/"*    "${peer_dir}/tls/server.key"

  # Derive the org MSP and cacert name from the peer MSP.
  cp -r "${peer_dir}/msp/cacerts" "${org_root}/msp/cacerts"
  mkdir -p "${org_root}/msp/tlscacerts"
  cp "${peer_dir}/tls/tlscacerts/"* "${org_root}/msp/tlscacerts/ca.crt"
  local cacert_name
  cacert_name="$(ls "${org_root}/msp/cacerts")"
  write_nodeou_config "${org_root}/msp" "${cacert_name}"
  cp "${org_root}/msp/config.yaml" "${peer_dir}/msp/config.yaml"

  # --- admin + User1 ---
  export FABRIC_CA_CLIENT_HOME="${org_root}"
  fabric-ca-client enroll -u "https://${org}-admin:adminpw@${CA_HOST}:${caport}" --caname "${caname}" \
    -M "${org_root}/users/Admin@${domain}/msp" \
    --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"
  cp "${org_root}/msp/config.yaml" "${org_root}/users/Admin@${domain}/msp/config.yaml"

  fabric-ca-client enroll -u "https://${org}-user1:user1pw@${CA_HOST}:${caport}" --caname "${caname}" \
    -M "${org_root}/users/User1@${domain}/msp" \
    --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"
  cp "${org_root}/msp/config.yaml" "${org_root}/users/User1@${domain}/msp/config.yaml"
  normalize_client_key "${org_root}/users/User1@${domain}/msp"

  # Fixed anchor-client identity (only for the anchor org).
  if [ -n "${extra_client}" ]; then
    fabric-ca-client enroll -u "https://${extra_client}:${extra_client}pw@${CA_HOST}:${caport}" --caname "${caname}" \
      -M "${org_root}/users/${extra_client}@${domain}/msp" \
      --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"
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
    fabric-ca-client register --caname "${caname}" --id.name "orderer${i}" --id.secret "orderer${i}pw" --id.type orderer \
      --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"
  done
  fabric-ca-client register --caname "${caname}" --id.name "orderer-admin" --id.secret adminpw --id.type admin \
    --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"

  mkdir -p "${org_root}/msp/tlscacerts"

  for i in 0 1 2; do
    local host="orderer${i}.example.com"
    local odir="${org_root}/orderers/${host}"
    export FABRIC_CA_CLIENT_HOME="${org_root}"
    fabric-ca-client enroll -u "https://orderer${i}:orderer${i}pw@${CA_HOST}:${caport}" --caname "${caname}" \
      -M "${odir}/msp" --csr.hosts "${host},localhost" \
      --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"
    fabric-ca-client enroll -u "https://orderer${i}:orderer${i}pw@${CA_HOST}:${caport}" --caname "${caname}" \
      -M "${odir}/tls" --enrollment.profile tls --csr.hosts "${host},localhost" \
      --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"
    cp "${odir}/tls/tlscacerts/"* "${odir}/tls/ca.crt"
    cp "${odir}/tls/signcerts/"*   "${odir}/tls/server.crt"
    cp "${odir}/tls/keystore/"*    "${odir}/tls/server.key"

    if [ "${i}" = "0" ]; then
      cp -r "${odir}/msp/cacerts" "${org_root}/msp/cacerts"
      cp "${odir}/tls/tlscacerts/"* "${org_root}/msp/tlscacerts/tlsca.example.com-cert.pem"
      local cacert_name
      cacert_name="$(ls "${org_root}/msp/cacerts")"
      write_nodeou_config "${org_root}/msp" "${cacert_name}"
    fi
    cp "${org_root}/msp/config.yaml" "${odir}/msp/config.yaml"
  done

  export FABRIC_CA_CLIENT_HOME="${org_root}"
  fabric-ca-client enroll -u "https://orderer-admin:adminpw@${CA_HOST}:${caport}" --caname "${caname}" \
    -M "${org_root}/users/Admin@${domain}/msp" \
    --tls.certfiles "${FABRIC_CA_DIR}/${caname}/tls-cert.pem"
  cp "${org_root}/msp/config.yaml" "${org_root}/users/Admin@${domain}/msp/config.yaml"
  echo "==> [orderer] done (OrdererMSP)"
}

main() {
  mkdir -p "${ORG_DIR}"
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
