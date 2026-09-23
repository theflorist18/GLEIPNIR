#!/usr/bin/env bash
# Back up / restore every gleipnir_* named Docker volume as one tarball per volume.
#   backup-volumes.sh <dir>            # <dir>/<volume>.tar.gz for every gleipnir_* volume
#   backup-volumes.sh <dir> --restore  # untar each <dir>/gleipnir_*.tar.gz into its volume
#
# Run this BEFORE reset-network.sh if the library data (gateway-auth-data,
# case-registry-data, evidence-blob-data) or a ledger must survive. Uses a
# throw-away `alpine` container; no host tools beyond docker are needed.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash: keep the -v mount paths untouched (no-op elsewhere)

DIR="${1:?usage: backup-volumes.sh <dir> [--restore]}"
MODE="${2:-}"
mkdir -p "${DIR}"
ABS="$(cd "${DIR}" && pwd)"

if [ "${MODE}" = "--restore" ]; then
  shopt -s nullglob
  files=("${ABS}"/gleipnir_*.tar.gz)
  [ ${#files[@]} -gt 0 ] || { echo "no gleipnir_*.tar.gz in ${ABS}" >&2; exit 1; }
  for f in "${files[@]}"; do
    vol="$(basename "${f}" .tar.gz)"
    docker volume create "${vol}" >/dev/null
    docker run --rm -v "${vol}:/v" -v "${ABS}:/backup:ro" alpine sh -c "cd /v && tar -xzf /backup/${vol}.tar.gz"
    echo "restored ${vol} <- ${f}"
  done
elif [ -n "${MODE}" ]; then
  echo "unknown option ${MODE}" >&2; exit 1
else
  vols="$(docker volume ls -q --filter name=gleipnir_)"
  [ -n "${vols}" ] || { echo "no gleipnir_* volumes found" >&2; exit 1; }
  for vol in ${vols}; do
    docker run --rm -v "${vol}:/v:ro" -v "${ABS}:/backup" alpine tar -czf "/backup/${vol}.tar.gz" -C /v .
    echo "backed up ${vol} -> ${ABS}/${vol}.tar.gz"
  done
fi
