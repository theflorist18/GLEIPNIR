#!/usr/bin/env bash
# GLEIPNIR teardown. `down.sh [--wipe]` stops all services (every profile); --wipe
# also removes the named ledger/receipt volumes and generated crypto + artifacts.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

WIPE="false"
[ "${1:-}" = "--wipe" ] && WIPE="true"

# Include every profile so profile-gated services are also removed.
ALL_PROFILES=(--profile anchoring --profile parallel-anchored)

if [ "${WIPE}" = "true" ]; then
  echo "== down --wipe: removing containers + named volumes =="
  compose "${ALL_PROFILES[@]}" down -v --remove-orphans
  rm -rf "${REPO_ROOT}/network/organizations" "${REPO_ROOT}/network/channel-artifacts"
  # reset generated ccaas ids
  set_env_var CCAAS_ID_APP unset
  set_env_var CCAAS_ID_ANCHOR unset
else
  echo "== down: stopping containers (volumes preserved) =="
  compose "${ALL_PROFILES[@]}" down --remove-orphans
fi
echo "== GLEIPNIR down complete =="
