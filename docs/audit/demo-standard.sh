#!/usr/bin/env bash
# ad-hoc demo walkthrough (not a test) — Standard variant, live via gateway REST
set -euo pipefail
GATEWAY=http://localhost:3000
AUTH=(-H "authorization: Bearer dev-token" -H "content-type: application/json")
EV="ev-demo-$(date +%s)"

echo "=== CreateEvidence (${EV}) ==="
curl -fsS "${AUTH[@]}" -X POST "$GATEWAY/api/v1/evidence" \
  -d "{\"evidenceId\":\"${EV}\",\"version\":\"1.0\",\"identity\":{\"org\":\"Org1MSP\",\"subject\":\"alice\"},\"storage\":{\"protocol\":\"file\",\"location\":\"blob://${EV}\"}}" | jq .

echo "=== TransferCustody -> bob ==="
curl -fsS "${AUTH[@]}" -X POST "$GATEWAY/api/v1/evidence/${EV}/transfer" \
  -d "{\"newCustodian\":\"bob\",\"reason\":\"demo handoff\"}" | jq .

echo "=== AccessLog x2 ==="
curl -fsS "${AUTH[@]}" -X POST "$GATEWAY/api/v1/evidence/${EV}/access" -d "{\"actor\":\"bob\",\"action\":\"view\"}" | jq .
curl -fsS "${AUTH[@]}" -X POST "$GATEWAY/api/v1/evidence/${EV}/access" -d "{\"actor\":\"carol\",\"action\":\"export\"}" | jq .

echo "=== Full audit trail (on-chain, one tx per event -- Standard variant) ==="
curl -fsS "${AUTH[@]}" "$GATEWAY/api/v1/evidence/${EV}/audit" | jq .

echo "=== Current evidence record ==="
curl -fsS "${AUTH[@]}" "$GATEWAY/api/v1/evidence/${EV}" | jq .
