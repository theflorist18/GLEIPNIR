#!/usr/bin/env bash
# GLEIPNIR evidence-library smoke test (M16) — Standard variant end-to-end via
# the gateway REST API, exercising the M12–M15 feature set: login + roles,
# case registry, multipart ingest into the evidence store, search, per-case
# authz, and the synchronous auto-AccessLog on view/download/export.
# Exits nonzero on any assertion failure.
# Labelled 'smoke' — functional correctness only, never a scalability datapoint.
#
# Prereq: up.sh --variant standard; curl + jq + sha256sum on PATH.
#         ADMIN_USERNAME/ADMIN_PASSWORD must match the gateway's seed
#         (network/compose/.env defaults: admin / admin-dev-password).
set -euo pipefail

GATEWAY="${GATEWAY_URL:-http://localhost:3000}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin-dev-password}"
TS="$(date +%s)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

fail() { echo "[smoke-library] FAIL: $*" >&2; exit 1; }

login() { # $1 username, $2 password -> token on stdout (empty on failure)
  curl -sS -X POST "${GATEWAY}/api/v1/auth/login" -H 'content-type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" | jq -r '.token // empty'
}

code_of() { # HTTP status only: code_of <token> <method> <url> [json-body]
  local token="$1" method="$2" url="$3" body="${4:-}"
  if [ -n "${body}" ]; then
    curl -sS -o /dev/null -w '%{http_code}' -X "${method}" "${url}" \
      -H "authorization: Bearer ${token}" -H 'content-type: application/json' -d "${body}"
  else
    curl -sS -o /dev/null -w '%{http_code}' -X "${method}" "${url}" \
      -H "authorization: Bearer ${token}"
  fi
}

audit_len() { # $1 token, $2 evidenceId
  curl -fsS -H "authorization: Bearer $1" "${GATEWAY}/api/v1/evidence/$2/audit" | jq 'length'
}

echo "[smoke-library] 1) admin login; create + login investigator and outsider"
ADMIN_TOKEN="$(login "${ADMIN_USERNAME}" "${ADMIN_PASSWORD}")"
[ -n "${ADMIN_TOKEN}" ] || fail "admin login (is the gateway seeded with ADMIN_USERNAME/ADMIN_PASSWORD?)"
AUTH_ADMIN=(-H "authorization: Bearer ${ADMIN_TOKEN}" -H "content-type: application/json")

IVY="ivy-${TS}"
MALLORY="mallory-${TS}"
curl -fsS "${AUTH_ADMIN[@]}" -X POST "${GATEWAY}/api/v1/admin/users" \
  -d "{\"username\":\"${IVY}\",\"password\":\"ivy-pw\",\"displayName\":\"Smoke Investigator\"}" >/dev/null
curl -fsS "${AUTH_ADMIN[@]}" -X POST "${GATEWAY}/api/v1/admin/users" \
  -d "{\"username\":\"${MALLORY}\",\"password\":\"mallory-pw\"}" >/dev/null
IVY_TOKEN="$(login "${IVY}" "ivy-pw")";         [ -n "${IVY_TOKEN}" ]     || fail "investigator login"
MALLORY_TOKEN="$(login "${MALLORY}" "mallory-pw")"; [ -n "${MALLORY_TOKEN}" ] || fail "outsider login"
AUTH_IVY=(-H "authorization: Bearer ${IVY_TOKEN}")

echo "[smoke-library] 2) admin creates a case and grants the investigator"
CASE_NAME="smoke-case-${TS}"
CASE_ID="$(curl -fsS "${AUTH_ADMIN[@]}" -X POST "${GATEWAY}/api/v1/cases" \
  -d "{\"name\":\"${CASE_NAME}\",\"description\":\"library smoke\"}" | jq -r '.id')"
case "${CASE_ID}" in CASE-*) ;; *) fail "case id '${CASE_ID}' not CASE-<uuid>" ;; esac
curl -fsS "${AUTH_ADMIN[@]}" -X POST "${GATEWAY}/api/v1/cases/${CASE_ID}/participants" \
  -d "{\"userId\":\"${IVY}\",\"roleInCase\":\"contributor\"}" >/dev/null

echo "[smoke-library] 3) investigator uploads real file bytes (multipart)"
EV="ev-smoke-lib-${TS}"
head -c 4096 /dev/urandom > "${WORK}/exhibit.bin"
UPLOAD="$(curl -fsS "${AUTH_IVY[@]}" -X POST "${GATEWAY}/api/v1/evidence" \
  -F "file=@${WORK}/exhibit.bin;type=application/octet-stream" -F "evidenceId=${EV}")"
PROOF="$(echo "${UPLOAD}" | jq -r '.integrityProof // empty')"
[ "$(echo "${UPLOAD}" | jq -r '.evidenceId')" = "${EV}" ] || fail "upload did not echo evidenceId: ${UPLOAD}"
case "${PROOF}" in "ni:///sha-256;"*) ;; *) fail "integrityProof missing/malformed: ${UPLOAD}" ;; esac

echo "[smoke-library] 4) assign to the case; roster shows filename/type/uploader"
curl -fsS "${AUTH_ADMIN[@]}" -X POST "${GATEWAY}/api/v1/cases/${CASE_ID}/evidence" \
  -d "{\"evidenceId\":\"${EV}\"}" >/dev/null
ROSTER_ROW="$(curl -fsS "${AUTH_IVY[@]}" "${GATEWAY}/api/v1/cases/${CASE_ID}" \
  | jq --arg ev "${EV}" '.evidence[] | select(.evidenceId == $ev)')"
[ "$(echo "${ROSTER_ROW}" | jq -r '.originalFilename')" = "exhibit.bin" ] || fail "roster filename: ${ROSTER_ROW}"
[ "$(echo "${ROSTER_ROW}" | jq -r '.mimeType')" = "application/octet-stream" ] || fail "roster mimeType: ${ROSTER_ROW}"
[ "$(echo "${ROSTER_ROW}" | jq -r '.uploadedBy')" = "${IVY}" ] || fail "roster uploadedBy: ${ROSTER_ROW}"

echo "[smoke-library] 5) case search and evidence search both find it"
FOUND_CASES="$(curl -fsS "${AUTH_IVY[@]}" "${GATEWAY}/api/v1/cases/search?q=${CASE_NAME}" | jq 'length')"
[ "${FOUND_CASES}" -ge 1 ] || fail "case search found ${FOUND_CASES}"
FOUND_EV="$(curl -fsS "${AUTH_IVY[@]}" "${GATEWAY}/api/v1/evidence/search?q=${EV}" | jq 'length')"
[ "${FOUND_EV}" -ge 1 ] || fail "evidence search found ${FOUND_EV}"

echo "[smoke-library] 6) view auto-logs: trail grows by one ACCESS"
curl -fsS "${AUTH_IVY[@]}" "${GATEWAY}/api/v1/evidence/${EV}" >/dev/null
C_VIEW="$(audit_len "${IVY_TOKEN}" "${EV}")"
[ "${C_VIEW}" = "2" ] || fail "expected 2 audit events after view (CREATE+ACCESS), got ${C_VIEW}"

echo "[smoke-library] 7) download: bytes hash-match, trail grows again"
curl -fsS "${AUTH_IVY[@]}" -o "${WORK}/downloaded.bin" "${GATEWAY}/api/v1/evidence/${EV}/download"
H1="$(sha256sum "${WORK}/exhibit.bin"   | cut -d' ' -f1)"
H2="$(sha256sum "${WORK}/downloaded.bin" | cut -d' ' -f1)"
[ "${H1}" = "${H2}" ] || fail "downloaded bytes differ from the upload (${H1} vs ${H2})"
C_DL="$(audit_len "${IVY_TOKEN}" "${EV}")"
[ "${C_DL}" = "3" ] || fail "expected 3 audit events after download, got ${C_DL}"

echo "[smoke-library] 8) export: 200 bundle, trail grows again"
EXPORT="$(curl -fsS "${AUTH_IVY[@]}" "${GATEWAY}/api/v1/evidence/${EV}/export")"
[ "$(echo "${EXPORT}" | jq -r '.evidenceId')" = "${EV}" ] || fail "export bundle: ${EXPORT}"
echo "${EXPORT}" | jq -e '.record and .auditTrail' >/dev/null || fail "export bundle incomplete"
C_EXP="$(audit_len "${IVY_TOKEN}" "${EV}")"
[ "${C_EXP}" = "4" ] || fail "expected 4 audit events after export, got ${C_EXP}"

echo "[smoke-library] 9) negatives: non-participant is denied"
[ "$(code_of "${MALLORY_TOKEN}" GET "${GATEWAY}/api/v1/cases/${CASE_ID}")" = "404" ] || fail "outsider case detail not 404"
[ "$(code_of "${MALLORY_TOKEN}" GET "${GATEWAY}/api/v1/evidence/${EV}")" = "403" ] || fail "outsider evidence read not 403"
[ "$(code_of "${MALLORY_TOKEN}" GET "${GATEWAY}/api/v1/evidence/${EV}/download")" = "403" ] || fail "outsider download not 403"

echo "[smoke-library] 10) negative: investigator cannot administer users"
[ "$(code_of "${IVY_TOKEN}" POST "${GATEWAY}/api/v1/admin/users" '{"username":"x","password":"x"}')" = "403" ] \
  || fail "investigator POST /admin/users not 403"

echo "[smoke-library] 11) final trail: CREATE + ACCESS(view) + ACCESS(download) + ACCESS(export) = 4"
TRAIL="$(curl -fsS "${AUTH_IVY[@]}" "${GATEWAY}/api/v1/evidence/${EV}/audit")"
[ "$(echo "${TRAIL}" | jq 'length')" = "4" ] || fail "final trail length != 4"
[ "$(echo "${TRAIL}" | jq '[.[] | select(.op=="CREATE")] | length')" = "1" ] || fail "expected exactly 1 CREATE"
[ "$(echo "${TRAIL}" | jq '[.[] | select(.op=="ACCESS")] | length')" = "3" ] || fail "expected exactly 3 ACCESS"

echo "[smoke-library] PASS — login/roles, case scoping, multipart ingest, search, and the synchronous auto-AccessLog all behave correctly"
