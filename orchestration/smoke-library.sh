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
  local extra=(); [ -z "${4:-}" ] || extra=(-H 'content-type: application/json' -d "$4")
  curl -sS -o /dev/null -w '%{http_code}' -X "$2" "$3" -H "authorization: Bearer $1" "${extra[@]}"
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
  -d "{\"username\":\"${IVY}\",\"password\":\"ivy-pw\",\"name\":\"Smoke Investigator\"}" >/dev/null
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

echo "[smoke-library] 12) M18: lead creates + owns a case; investigator cannot create"
LENA="lena-${TS}"
curl -fsS "${AUTH_ADMIN[@]}" -X POST "${GATEWAY}/api/v1/admin/users" \
  -d "{\"username\":\"${LENA}\",\"password\":\"lena-pw\",\"role\":\"lead\"}" >/dev/null
LENA_TOKEN="$(login "${LENA}" "lena-pw")"; [ -n "${LENA_TOKEN}" ] || fail "lead login"
AUTH_LENA=(-H "authorization: Bearer ${LENA_TOKEN}" -H "content-type: application/json")
LEAD_CASE_ID="$(curl -fsS "${AUTH_LENA[@]}" -X POST "${GATEWAY}/api/v1/cases" \
  -d "{\"name\":\"lead-case-${TS}\"}" | jq -r '.id')"
case "${LEAD_CASE_ID}" in CASE-*) ;; *) fail "lead case create: '${LEAD_CASE_ID}'" ;; esac
MY_ROLE="$(curl -fsS "${AUTH_LENA[@]}" "${GATEWAY}/api/v1/cases/${LEAD_CASE_ID}" \
  | jq -r --arg u "${LENA}" '.participants[] | select(.userId == $u) | .roleInCase')"
[ "${MY_ROLE}" = "lead" ] || fail "lead creator roleInCase '${MY_ROLE}' != lead"
[ "$(code_of "${IVY_TOKEN}" POST "${GATEWAY}/api/v1/cases" '{"name":"nope"}')" = "403" ] \
  || fail "investigator case create not 403"

echo "[smoke-library] 13) M18: lead manages their roster; only their own"
curl -fsS "${AUTH_LENA[@]}" -X POST "${GATEWAY}/api/v1/cases/${LEAD_CASE_ID}/participants" \
  -d "{\"userId\":\"${IVY}\",\"roleInCase\":\"contributor\"}" >/dev/null
[ "$(code_of "${LENA_TOKEN}" POST "${GATEWAY}/api/v1/cases/${CASE_ID}/participants" \
  "{\"userId\":\"${MALLORY}\"}")" = "404" ] || fail "lead touching a foreign roster not 404"

echo "[smoke-library] 14) M18: admin reads metadata/trails but not blob content off-case"
[ "$(code_of "${ADMIN_TOKEN}" GET "${GATEWAY}/api/v1/evidence/${EV}")" = "200" ] || fail "admin view not 200"
[ "$(code_of "${ADMIN_TOKEN}" GET "${GATEWAY}/api/v1/evidence/${EV}/audit")" = "200" ] || fail "admin audit not 200"
[ "$(code_of "${ADMIN_TOKEN}" GET "${GATEWAY}/api/v1/evidence/${EV}/download")" = "403" ] \
  || fail "admin download of a non-participant case not 403"

echo "[smoke-library] 15) M19: lead creates a category; ingest carries forensic metadata"
CAT_ID="$(curl -fsS "${AUTH_LENA[@]}" -X POST "${GATEWAY}/api/v1/cases/${LEAD_CASE_ID}/categories" \
  -d '{"name":"Physical Media"}' | jq -r '.id')"
case "${CAT_ID}" in cat-*) ;; *) fail "category create: '${CAT_ID}'" ;; esac
EV2="ev-smoke-meta-${TS}"
head -c 1024 /dev/urandom > "${WORK}/exhibit2.bin"
curl -fsS "${AUTH_IVY[@]}" -X POST "${GATEWAY}/api/v1/evidence" \
  -F "file=@${WORK}/exhibit2.bin;type=application/octet-stream" -F "evidenceId=${EV2}" \
  -F "caseId=${LEAD_CASE_ID}" -F "categoryId=${CAT_ID}" -F "label=ITEM-001" \
  -F "seizedAt=2026-07-15T09:30:00Z" -F "acquisitionLocation=smoke locker" >/dev/null
META_ROW="$(curl -fsS "${AUTH_IVY[@]}" "${GATEWAY}/api/v1/cases/${LEAD_CASE_ID}" \
  | jq --arg ev "${EV2}" '.evidence[] | select(.evidenceId == $ev)')"
[ "$(echo "${META_ROW}" | jq -r '.label')" = "ITEM-001" ] || fail "metadata label: ${META_ROW}"
[ "$(echo "${META_ROW}" | jq -r '.categoryId')" = "${CAT_ID}" ] || fail "metadata categoryId: ${META_ROW}"
[ "$(echo "${META_ROW}" | jq -r '.seizedAt')" = "2026-07-15T09:30:00Z" ] || fail "metadata seizedAt: ${META_ROW}"

echo "[smoke-library] 16) M20: examiner note, flag, and the case activity feed"
NOTE_ID="$(curl -fsS "${AUTH_IVY[@]}" -H 'content-type: application/json' \
  -X POST "${GATEWAY}/api/v1/evidence/${EV2}/notes" \
  -d '{"body":"smoke examiner note"}' | jq -r '.id')"
case "${NOTE_ID}" in note-*) ;; *) fail "note create: '${NOTE_ID}'" ;; esac
NOTES_LEN="$(curl -fsS "${AUTH_IVY[@]}" "${GATEWAY}/api/v1/evidence/${EV2}/notes" | jq 'length')"
[ "${NOTES_LEN}" -ge 1 ] || fail "notes list length ${NOTES_LEN}"
FLAG="$(curl -fsS "${AUTH_IVY[@]}" -H 'content-type: application/json' \
  -X PUT "${GATEWAY}/api/v1/evidence/${EV2}/flag" -d '{"flag":"HIGH_PRIORITY"}' | jq -r '.flag')"
[ "${FLAG}" = "HIGH_PRIORITY" ] || fail "flag set: '${FLAG}'"
ACTIVITY="$(curl -fsS "${AUTH_IVY[@]}" "${GATEWAY}/api/v1/cases/${LEAD_CASE_ID}/activity")"
[ "$(echo "${ACTIVITY}" | jq 'length')" -ge 4 ] || fail "activity feed too short: ${ACTIVITY}"
echo "${ACTIVITY}" | jq -e '[.[] | select(.type=="NOTE_ADDED")] | length >= 1' >/dev/null || fail "activity missing NOTE_ADDED"

echo "[smoke-library] 17) M24: per-case CoC report (json + csv) — runs LAST: it appends one ACCESS per exhibit"
REPORT="$(curl -fsS "${AUTH_IVY[@]}" "${GATEWAY}/api/v1/cases/${LEAD_CASE_ID}/coc-report")"
[ "$(echo "${REPORT}" | jq -r '.caseId')" = "${LEAD_CASE_ID}" ] || fail "coc-report caseId: ${REPORT}"
echo "${REPORT}" | jq -e '.evidence[0].auditTrail | length >= 1' >/dev/null || fail "coc-report missing trails"
CSV_HEAD="$(curl -fsS "${AUTH_IVY[@]}" "${GATEWAY}/api/v1/cases/${LEAD_CASE_ID}/coc-report?format=csv" | head -1)"
case "${CSV_HEAD}" in '"caseId","caseName","evidenceLabel",'*) ;; *) fail "coc-report csv header: ${CSV_HEAD}" ;; esac
CSV_CREATE="$(curl -fsS "${AUTH_IVY[@]}" "${GATEWAY}/api/v1/cases/${LEAD_CASE_ID}/coc-report?format=csv" | grep -c '"CREATE"')"
[ "${CSV_CREATE}" -ge 1 ] || fail "coc-report csv has no CREATE rows"

echo "[smoke-library] PASS — login/3-tier roles, case scoping, lead-owned cases, categories + forensic ingest metadata, examiner notes/flags/activity, the CoC report, multipart ingest, search, the admin content restriction, and the synchronous auto-AccessLog all behave correctly"
