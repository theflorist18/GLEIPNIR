#!/usr/bin/env bash
# Remove a per-case channel from the orderers. `teardown-channel.sh case-00N`.
#
# KNOWN LIMIT: this removes the channel from the ORDERERS (osnadmin channel
# remove). Peers cannot un-join a channel while running — `peer node unjoin`
# requires the peer to be stopped (Fabric 2.5). So the peers' ledger for this
# channel remains until the next `down.sh --wipe`. This is a documented
# limitation, not a bug.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

CASE_ID="${1:?usage: teardown-channel.sh case-NNN}"
# Same guard as provision-channel.sh (audit F71): an arbitrary arg would reach
# `rm -f networks/${CASE_ID}.yaml` — e.g. `case-template` would delete the SOURCE.
if ! [[ "${CASE_ID}" =~ ^case-[0-9]{3}$ ]]; then
  echo "invalid CASE_ID '${CASE_ID}' (expected case-NNN)" >&2
  exit 1
fi
for admin in "${ORDERER_ADMINS[@]}"; do
  echo "osnadmin channel remove ${CASE_ID} -> ${admin}"
  cli "osnadmin channel remove --channelID ${CASE_ID} -o ${admin} \
    --ca-file ${ORDERER0_CA} --client-cert ${ORDERER0_ADMIN_CERT} --client-key ${ORDERER0_ADMIN_KEY}" || true
done
rm -f "${REPO_ROOT}/benchmark/networks/${CASE_ID}.yaml"
echo "channel ${CASE_ID} removed from orderers (peer ledgers persist until down.sh --wipe)"
