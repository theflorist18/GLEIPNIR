#!/usr/bin/env bash
# Provision ONE per-case channel (Parallel / Parallel-Anchored) and emit a matching
# Caliper network config. `provision-channel.sh case-00N`.
# Idempotent-safe: skips creation if the channel already exists on orderer0.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

CASE_ID="${1:?usage: provision-channel.sh case-NNN}"
if ! echo "${CASE_ID}" | grep -Eq '^case-[0-9]{3}$'; then
  echo "caseId must match case-NNN (got ${CASE_ID})" >&2; exit 1
fi

# Skip if already joined on orderer0.
if cli "osnadmin channel list -o ${ORDERER_ADMINS[0]} --ca-file ${ORDERER0_CA} --client-cert ${ORDERER0_ADMIN_CERT} --client-key ${ORDERER0_ADMIN_KEY} 2>/dev/null | grep -q '\"${CASE_ID}\"'"; then
  echo "channel ${CASE_ID} already exists — skipping creation"
else
  create_channel "${CASE_ID}" AppChannel
  join_peer org1 "${CASE_ID}"
  join_peer org2 "${CASE_ID}"

  pkg_host="ccaas-evidence"
  pkgid="$(package_ccaas "${pkg_host}" "" | tail -1 | tr -d '\r')"
  cli "$(peer_env org1)
peer lifecycle chaincode install ${CTN_ARTIFACTS}/${CC_NAME}-${pkg_host}.tar.gz" || true
  cli "$(peer_env org2)
peer lifecycle chaincode install ${CTN_ARTIFACTS}/${CC_NAME}-${pkg_host}.tar.gz" || true
  policy="OR('Org1MSP.peer','Org2MSP.peer')"
  for org in org1 org2; do
    cli "$(peer_env ${org})
peer lifecycle chaincode approveformyorg -o ${ORDERER0} --ordererTLSHostnameOverride orderer0.example.com \
  --channelID ${CASE_ID} --name ${CC_NAME} --version ${CC_VERSION} --package-id ${pkgid} --sequence 1 \
  --signature-policy \"${policy}\" --tls --cafile ${ORDERER0_CA}"
  done
  cli "$(peer_env org1)
peer lifecycle chaincode commit -o ${ORDERER0} --ordererTLSHostnameOverride orderer0.example.com \
  --channelID ${CASE_ID} --name ${CC_NAME} --version ${CC_VERSION} --sequence 1 --signature-policy \"${policy}\" \
  --tls --cafile ${ORDERER0_CA} \
  --peerAddresses peer0.org1.example.com:7051 --tlsRootCertFiles ${CTN_ORG}/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt \
  --peerAddresses peer0.org2.example.com:9051 --tlsRootCertFiles ${CTN_ORG}/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt"
fi

# Emit the per-case Caliper network config from the template.
TEMPLATE="${REPO_ROOT}/benchmark/networks/case-template.yaml"
OUT="${REPO_ROOT}/benchmark/networks/${CASE_ID}.yaml"
sed "s/__CHANNEL__/${CASE_ID}/g" "${TEMPLATE}" > "${OUT}"
echo "emitted ${OUT}"
