#!/usr/bin/env bash
# GLEIPNIR smoke test (milestone 4) — Standard variant end-to-end via the gateway
# REST API: create -> transfer -> access x2 -> audit-trail asserts 4 events ->
# dispose (status transition) -> head status DISPOSED -> a further transfer must FAIL. Exits nonzero on any assertion failure.
# Labelled 'smoke' — functional correctness only, never a scalability datapoint.
#
# Prereq: gateway up (up.sh --variant standard); curl + jq on PATH.
set -euo pipefail

GATEWAY="${GATEWAY_URL:-http://localhost:3000}"
TOKEN="${GLEIPNIR_TOKEN:-dev-token}"
AUTH=(-H "authorization: Bearer ${TOKEN}" -H "content-type: application/json")
EV="ev-smoke-$(date +%s)"

echo "[smoke] create ${EV}"
curl -fsS "${AUTH[@]}" -X POST "${GATEWAY}/api/v1/evidence" \
  -d "{\"evidenceId\":\"${EV}\",\"version\":\"1.0\",\"identity\":{\"org\":\"Org1MSP\",\"subject\":\"alice\"},\"storage\":{\"protocol\":\"file\",\"location\":\"blob://${EV}\"}}" >/dev/null

echo "[smoke] transfer custody"
curl -fsS "${AUTH[@]}" -X POST "${GATEWAY}/api/v1/evidence/${EV}/transfer" \
  -d '{"newCustodian":"bob","reason":"handoff"}' >/dev/null

echo "[smoke] access x2"
curl -fsS "${AUTH[@]}" -X POST "${GATEWAY}/api/v1/evidence/${EV}/access" -d '{"actor":"bob","action":"view"}' >/dev/null
curl -fsS "${AUTH[@]}" -X POST "${GATEWAY}/api/v1/evidence/${EV}/access" -d '{"actor":"carol","action":"export"}' >/dev/null

echo "[smoke] audit trail must have 4 events (CREATE, TRANSFER, ACCESS, ACCESS)"
COUNT="$(curl -fsS "${AUTH[@]}" "${GATEWAY}/api/v1/evidence/${EV}/audit" | jq 'length')"
if [ "${COUNT}" != "4" ]; then
  echo "[smoke] FAIL: expected 4 audit events, got ${COUNT}" >&2; exit 1
fi

echo "[smoke] dispose (status transition, terminal)"
curl -fsS "${AUTH[@]}" -X DELETE "${GATEWAY}/api/v1/evidence/${EV}" -d '{"reason":"disposed"}' >/dev/null

echo "[smoke] head status must be DISPOSED (nothing is deleted)"
STATUS="$(curl -fsS "${AUTH[@]}" "${GATEWAY}/api/v1/evidence/${EV}" | jq -r '.status')"
if [ "${STATUS}" != "DISPOSED" ]; then
  echo "[smoke] FAIL: expected status DISPOSED, got ${STATUS}" >&2; exit 1
fi

echo "[smoke] a transfer after dispose must FAIL"
if curl -fsS "${AUTH[@]}" -X POST "${GATEWAY}/api/v1/evidence/${EV}/transfer" -d '{"newCustodian":"dave","reason":"late"}' >/dev/null 2>&1; then
  echo "[smoke] FAIL: transfer after dispose unexpectedly succeeded" >&2; exit 1
fi

echo "[smoke] PASS — Standard variant create/transfer/access/audit/dispose behaves correctly"
