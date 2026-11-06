#!/usr/bin/env bash
#
# GLEIPNIR bring-up (docs/CONTRACTS.md §8, §11; docs/ARCHITECTURE.md §4.6).
#   up.sh --variant <standard|anchoring|parallel|parallel-anchored> [--channels N]
#         [--endorsement any|all] [--skip-crypto]
#
# Maps variant -> compose profiles, enrolls crypto, starts the network, creates
# channels via osnadmin (asserting HTTP 201 on all three orderers), deploys the
# evidence chaincode as a service, and starts the off-chain services.
# --endorsement sets the chaincode endorsement policy on every app channel:
# any = 1-of-any (default), all = 2-of-2 (lib.sh endorsement_policy).
#
# Prereqs: docker + compose v2; fabric-ca-client + curl + jq on PATH (host).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

VARIANT="standard"
CHANNELS=1
ENDORSEMENT="any"
SKIP_CRYPTO="false"
while [ $# -gt 0 ]; do
  case "$1" in
    --variant) VARIANT="$2"; shift 2 ;;
    --channels) CHANNELS="$2"; shift 2 ;;
    --endorsement) ENDORSEMENT="$2"; shift 2 ;;
    --skip-crypto) SKIP_CRYPTO="true"; shift ;;
    *) echo "unknown arg $1" >&2; exit 1 ;;
  esac
done

# variant -> compose profiles (the anchored variants add the batcher,
# receipt-store and verification services)
PROFILE_ARGS=()
case "${VARIANT}" in
  standard|parallel) ;;
  anchoring)         PROFILE_ARGS=(--profile anchoring) ;;
  parallel-anchored) PROFILE_ARGS=(--profile parallel-anchored) ;;
  *) echo "invalid --variant ${VARIANT}" >&2; exit 1 ;;
esac
case "${ENDORSEMENT}" in
  any|all) ;;
  *) echo "invalid --endorsement ${ENDORSEMENT} (any|all)" >&2; exit 1 ;;
esac

echo "== GLEIPNIR up: variant=${VARIANT} channels=${CHANNELS} endorsement=${ENDORSEMENT} =="
set_env_var VARIANT "${VARIANT}"
set_env_var ENDORSEMENT "${ENDORSEMENT}"

# 1) CAs + crypto
if [ "${SKIP_CRYPTO}" != "true" ]; then
  echo "== enrolling crypto (CAs) =="
  compose up -d ca-org1 ca-org2 ca-orderer
  sleep 3
  bash "${REPO_ROOT}/network/crypto/registerEnroll.sh"
fi

# 2) network
echo "== starting orderers + peers + cli =="
compose "${PROFILE_ARGS[@]}" up -d

echo "== waiting for orderers/peers to report healthy =="
wait_healthz 9443 orderer0
wait_healthz 9446 peer0-org1
wait_healthz 9447 peer0-org2
# A peer's operations /healthz answers before its gRPC endpoint serves; the
# first lifecycle command below would then fail to connect.
wait_peer_grpc org1
wait_peer_grpc org2

# 3) channels + chaincode
# Chaincode install is org-scoped, not channel-scoped: package + install happen
# exactly once. A per-channel re-install exits non-zero, which under set -e
# would abort a `--channels N>1` bring-up at the second channel.
APP_PKGID=""
install_app_chaincode() {
  local pkg_host="ccaas-evidence"
  APP_PKGID="$(package_ccaas "${pkg_host}" | tail -1 | tr -d '\r')"
  echo "    app package id = ${APP_PKGID}"
  set_env_var CCAAS_ID_APP "${APP_PKGID}"

  cli "$(peer_env org1)
peer lifecycle chaincode install ${CTN_ARTIFACTS}/${CC_NAME}-${pkg_host}.tar.gz"
  cli "$(peer_env org2)
peer lifecycle chaincode install ${CTN_ARTIFACTS}/${CC_NAME}-${pkg_host}.tar.gz"

  # (re)start the ccaas server with the resolved package id before any commit.
  compose "${PROFILE_ARGS[@]}" up -d ccaas-evidence
}

install_app_chaincode
case "${VARIANT}" in
  standard|anchoring)
    app_channel coc-main "${APP_PKGID}"
    ;;
  parallel|parallel-anchored)
    for i in $(seq 1 "${CHANNELS}"); do
      app_channel "$(printf 'case-%03d' "${i}")" "${APP_PKGID}"
    done
    ;;
esac

# 4) off-chain services (gateway/frontend/case-registry/evidence-store always;
#    batcher/receipt-store/verification on the anchored variants)
echo "== starting services =="
compose "${PROFILE_ARGS[@]}" up -d gateway frontend case-registry evidence-store
if [ "${VARIANT}" = "anchoring" ] || [ "${VARIANT}" = "parallel-anchored" ]; then
  compose "${PROFILE_ARGS[@]}" up -d merkle-batcher receipt-store verification
fi

echo "== GLEIPNIR up complete (variant=${VARIANT}). Gateway :3000, frontend :8081 =="
