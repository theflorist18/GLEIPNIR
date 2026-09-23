#!/usr/bin/env bash
# GLEIPNIR ledger-only reset between benchmark runs (supervisor brief 2026-09-22 §9).
#   GLEIPNIR_ALLOW_LEDGER_WIPE=1 reset-network.sh --variant V --channels C
#
# Fresh ledgers are required for storage measurement and independent repetitions.
# This removes ONLY the ledger/witness volumes listed below, then re-runs up.sh
# with the existing crypto (--skip-crypto). It NEVER removes gateway-auth-data,
# case-registry-data, evidence-blob-data (the evidence library), CA state, or
# network/organizations. Refuses to run without the env flag — a wipe destroyed
# hand-built library data once (memory: never wipe without asking).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

VARIANT=""
CHANNELS=1
while [ $# -gt 0 ]; do
  case "$1" in
    --variant) VARIANT="$2"; shift 2 ;;
    --channels) CHANNELS="$2"; shift 2 ;;
    *) echo "unknown arg $1" >&2; exit 1 ;;
  esac
done
case "${VARIANT}" in
  standard|anchoring|parallel|parallel-anchored) ;;
  *) echo "usage: reset-network.sh --variant <standard|anchoring|parallel|parallel-anchored> [--channels N]" >&2; exit 1 ;;
esac

LEDGER_VOLUMES=(
  gleipnir_orderer0-ledger gleipnir_orderer1-ledger gleipnir_orderer2-ledger
  gleipnir_peer0org1-ledger gleipnir_peer0org2-ledger gleipnir_peer0anchor-ledger
  gleipnir_receipt-data gleipnir_verify-metrics
)

if [ "${GLEIPNIR_ALLOW_LEDGER_WIPE:-}" != "1" ]; then
  echo "reset-network.sh: refusing to wipe ledgers — set GLEIPNIR_ALLOW_LEDGER_WIPE=1 to confirm." >&2
  echo "It would remove: ${LEDGER_VOLUMES[*]}" >&2
  echo "(never: gleipnir_gateway-auth-data, gleipnir_case-registry-data, gleipnir_evidence-blob-data, CA state)" >&2
  exit 2
fi
if [ ! -d "${REPO_ROOT}/network/organizations/peerOrganizations" ]; then
  echo "no crypto material in network/organizations — run up.sh --variant ${VARIANT} once WITHOUT --skip-crypto first" >&2
  exit 1
fi

echo "== reset-network: variant=${VARIANT} channels=${CHANNELS} =="
echo "volumes to remove (ledgers + off-chain witness only):"
printf '  %s\n' "${LEDGER_VOLUMES[@]}"
echo "kept: gleipnir_gateway-auth-data gleipnir_case-registry-data gleipnir_evidence-blob-data, CA state, network/organizations"

echo "== down (all profiles, volumes kept) =="
compose --profile anchoring --profile parallel-anchored down --remove-orphans

echo "== removing ledger volumes =="
for vol in "${LEDGER_VOLUMES[@]}"; do
  if docker volume inspect "${vol}" >/dev/null 2>&1; then
    docker volume rm "${vol}" >/dev/null   # a failure here (volume in use) must abort, not continue
    echo "  removed ${vol}"
  else
    echo "  absent  ${vol}"
  fi
done

rm -rf "${REPO_ROOT}/network/channel-artifacts"
set_env_var CCAAS_ID_APP unset
set_env_var CCAAS_ID_ANCHOR unset

echo "== up.sh --variant ${VARIANT} --channels ${CHANNELS} --skip-crypto =="
bash "${SCRIPT_DIR}/up.sh" --variant "${VARIANT}" --channels "${CHANNELS}" --skip-crypto
echo "== reset-network complete =="
