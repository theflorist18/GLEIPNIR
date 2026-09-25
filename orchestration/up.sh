#!/usr/bin/env bash
#
# GLEIPNIR bring-up (docs/CONTRACTS.md §8, §11; ARCHITECTURE §4.6, milestone 1).
#   up.sh --variant <standard|anchoring|parallel|parallel-anchored> [--channels N] [--skip-crypto]
#
# Maps variant -> compose profiles, enrolls crypto, starts the network, creates
# channels via osnadmin (asserting HTTP 201 on all three orderers), deploys the
# evidence chaincode as a service, and starts the off-chain services.
#
# Prereqs: docker + compose v2; fabric-ca-client + curl + jq on PATH (host).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

VARIANT="standard"
CHANNELS=1
SKIP_CRYPTO="false"
while [ $# -gt 0 ]; do
  case "$1" in
    --variant) VARIANT="$2"; shift 2 ;;
    --channels) CHANNELS="$2"; shift 2 ;;
    --skip-crypto) SKIP_CRYPTO="true"; shift ;;
    *) echo "unknown arg $1" >&2; exit 1 ;;
  esac
done

# variant -> compose profiles + crypto flags
PROFILE_ARGS=()
ENABLE_ANCHOR_ORG="false"
case "${VARIANT}" in
  standard)          ;;
  anchoring)         PROFILE_ARGS=(--profile anchoring) ;;
  parallel)          ;;
  parallel-anchored) PROFILE_ARGS=(--profile parallel-anchored); ENABLE_ANCHOR_ORG="true" ;;
  *) echo "invalid --variant ${VARIANT}" >&2; exit 1 ;;
esac
export ENABLE_ANCHOR_ORG

echo "== GLEIPNIR up: variant=${VARIANT} channels=${CHANNELS} =="
set_env_var VARIANT "${VARIANT}"

# 1) CAs + crypto
if [ "${SKIP_CRYPTO}" != "true" ]; then
  echo "== enrolling crypto (CAs) =="
  compose up -d ca-org1 ca-org2 ca-orderer
  [ "${ENABLE_ANCHOR_ORG}" = "true" ] && compose "${PROFILE_ARGS[@]}" up -d ca-anchor
  sleep 3
  ENABLE_ANCHOR_ORG="${ENABLE_ANCHOR_ORG}" bash "${REPO_ROOT}/network/crypto/registerEnroll.sh"
elif [ "${ENABLE_ANCHOR_ORG}" = "true" ] && [ -z "$(ls "${REPO_ROOT}/network/organizations/peerOrganizations/anchor.example.com/peers/peer0.anchor.example.com/msp/signcerts" 2>/dev/null)" ]; then
  # --skip-crypto reuses existing crypto, but a stack first brought up as another variant has
  # no anchor org (docker may even have created its bind-mount dirs empty): enroll ONLY the
  # anchor org; org1/org2/orderer material is left untouched.
  echo "== enrolling the missing anchor-org crypto (other orgs reused) =="
  rm -rf "${REPO_ROOT}/network/organizations/peerOrganizations/anchor.example.com"
  compose "${PROFILE_ARGS[@]}" up -d ca-anchor
  sleep 3
  bash "${REPO_ROOT}/network/crypto/registerEnroll.sh" anchor-only
fi

# 2) network
echo "== starting orderers + peers + cli =="
compose "${PROFILE_ARGS[@]}" up -d

echo "== waiting for orderers/peers to report healthy =="
wait_healthz 9443 orderer0
wait_healthz 9446 peer0-org1
wait_healthz 9447 peer0-org2
[ "${VARIANT}" = "parallel-anchored" ] && wait_healthz 9448 peer0-anchor

# 3) channels + chaincode
# Chaincode install is ORG-scoped, not channel-scoped: package + install happen
# exactly once (audit F46 — a per-channel re-install exits non-zero under
# set -e and killed `--channels N>1` bring-up at the second channel).
APP_PKGID=""
install_app_chaincode() {
  local pkg_host="ccaas-evidence"
  APP_PKGID="$(package_ccaas "${pkg_host}" "" | tail -1 | tr -d '\r')"
  echo "    app package id = ${APP_PKGID}"
  set_env_var CCAAS_ID_APP "${APP_PKGID}"

  cli "$(peer_env org1)
peer lifecycle chaincode install ${CTN_ARTIFACTS}/${CC_NAME}-${pkg_host}.tar.gz"
  cli "$(peer_env org2)
peer lifecycle chaincode install ${CTN_ARTIFACTS}/${CC_NAME}-${pkg_host}.tar.gz"

  # (re)start the ccaas server with the resolved package id before any commit.
  compose "${PROFILE_ARGS[@]}" up -d ccaas-evidence
}

deploy_app_chaincode() {  # <channel> — approve + commit only (install hoisted)
  local channel="$1"
  local pkgid="${APP_PKGID}"

  local policy="OR('Org1MSP.peer','Org2MSP.peer')"
  for org in org1 org2; do
    cli "$(peer_env ${org})
peer lifecycle chaincode approveformyorg -o ${ORDERER0} --ordererTLSHostnameOverride orderer0.example.com \
  --channelID ${channel} --name ${CC_NAME} --version ${CC_VERSION} --package-id ${pkgid} --sequence 1 \
  --signature-policy \"${policy}\" --tls --cafile ${ORDERER0_CA}"
  done
  cli "$(peer_env org1)
peer lifecycle chaincode commit -o ${ORDERER0} --ordererTLSHostnameOverride orderer0.example.com \
  --channelID ${channel} --name ${CC_NAME} --version ${CC_VERSION} --sequence 1 --signature-policy \"${policy}\" \
  --tls --cafile ${ORDERER0_CA} \
  --peerAddresses peer0.org1.example.com:7051 --tlsRootCertFiles ${CTN_ORG}/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt \
  --peerAddresses peer0.org2.example.com:9051 --tlsRootCertFiles ${CTN_ORG}/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt"
}

deploy_anchor_chaincode() {  # anchor-main
  local channel="anchor-main"
  local pkg_host="ccaas-evidence-anchor"
  local pkgid
  pkgid="$(package_ccaas "${pkg_host}" "" | tail -1 | tr -d '\r')"
  echo "    anchor package id = ${pkgid}"
  set_env_var CCAAS_ID_ANCHOR "${pkgid}"
  cli "$(peer_env anchor)
peer lifecycle chaincode install ${CTN_ARTIFACTS}/${CC_NAME}-${pkg_host}.tar.gz"
  compose "${PROFILE_ARGS[@]}" up -d ccaas-evidence-anchor
  local policy="AND('AnchorClientMSP.member')"
  cli "$(peer_env anchor)
peer lifecycle chaincode approveformyorg -o ${ORDERER0} --ordererTLSHostnameOverride orderer0.example.com \
  --channelID ${channel} --name ${CC_NAME} --version ${CC_VERSION} --package-id ${pkgid} --sequence 1 \
  --signature-policy \"${policy}\" --tls --cafile ${ORDERER0_CA}
peer lifecycle chaincode commit -o ${ORDERER0} --ordererTLSHostnameOverride orderer0.example.com \
  --channelID ${channel} --name ${CC_NAME} --version ${CC_VERSION} --sequence 1 --signature-policy \"${policy}\" \
  --tls --cafile ${ORDERER0_CA} \
  --peerAddresses peer0.anchor.example.com:11051 --tlsRootCertFiles ${CTN_ORG}/peerOrganizations/anchor.example.com/peers/peer0.anchor.example.com/tls/ca.crt"
}

case "${VARIANT}" in
  standard|anchoring)
    install_app_chaincode
    create_channel coc-main AppChannel
    join_peer org1 coc-main
    join_peer org2 coc-main
    wait_raft_leader org1 coc-main
    deploy_app_chaincode coc-main
    ;;
  parallel|parallel-anchored)
    install_app_chaincode
    for i in $(seq 1 "${CHANNELS}"); do
      ch="$(printf 'case-%03d' "${i}")"
      create_channel "${ch}" AppChannel
      join_peer org1 "${ch}"
      join_peer org2 "${ch}"
      wait_raft_leader org1 "${ch}"
      deploy_app_chaincode "${ch}"
    done
    if [ "${VARIANT}" = "parallel-anchored" ]; then
      create_channel anchor-main AnchorChannel
      join_peer anchor anchor-main
      wait_raft_leader anchor anchor-main
      deploy_anchor_chaincode
    fi
    ;;
esac

# 4) off-chain services (gateway/frontend/case-registry/evidence-store always;
#    batcher/receipt/verification/anchor per profile)
echo "== starting services =="
compose "${PROFILE_ARGS[@]}" up -d gateway frontend case-registry evidence-store
if [ "${VARIANT}" = "anchoring" ] || [ "${VARIANT}" = "parallel-anchored" ]; then
  compose "${PROFILE_ARGS[@]}" up -d merkle-batcher receipt-store verification
fi
[ "${VARIANT}" = "parallel-anchored" ] && compose "${PROFILE_ARGS[@]}" up -d anchor-client

echo "== GLEIPNIR up complete (variant=${VARIANT}). Gateway :3000, frontend :8081 =="
