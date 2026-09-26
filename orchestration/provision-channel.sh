#!/usr/bin/env bash
# Provision ONE per-case channel (Parallel / Parallel-Anchored). `provision-channel.sh case-00N`.
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
  # Approve/commit with the package id up.sh installed on both peers (install is
  # org-scoped) and the running ccaas container serves (CCAAS_ID_APP).
  pkgid="$(grep -E '^CCAAS_ID_APP=' "${COMPOSE_DIR}/.env" | cut -d= -f2 | tr -d '\r')"
  [ -n "${pkgid}" ] || { echo "CCAAS_ID_APP not set in ${COMPOSE_DIR}/.env — run up.sh --variant parallel first" >&2; exit 1; }
  app_channel "${CASE_ID}" "${pkgid}"
fi
