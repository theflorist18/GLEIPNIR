#!/usr/bin/env bash
# GLEIPNIR receipt-store tamper demonstration (anchored variants): what each
# attack on the off-chain witness does to verification and to the audit trail.
#
#   tamper-test.sh [--out FILE]
#
# One new evidence gets four events (CREATE, TRANSFER, ACCESS, ACCESS); the
# batcher is flushed so their batch is anchored, and every event must verify.
# Then, one attack at a time, each undone before the next:
#   changed event copy     event.actor rewritten           -> root-mismatch (detected)
#   changed sibling path   one path hash rewritten         -> root-mismatch (detected:
#                          the proof is blocked, no other event can be proven with it)
#   deleted receipt        the receipt file removed        -> missing-receipt on verify,
#                          but the trail just lists one event fewer (not detected by the
#                          trail; the on-chain root still records the batch's leafCount)
#   replay via the gateway the same request sent again     -> a new event with a new
#                          eventId (recorded, not recognised as a replay)
#   replay into the batcher the same eventId re-enqueued   -> 409 inside the open batch;
#                          after the boundary accepted again into a later batch, and
#                          its receipt (the witness) is overwritten
# The receipt store is deliberately not hardened; this shows what that means.
# Exits 0 when every outcome is the documented one, 1 otherwise, 2 when the
# stack gives no usable answer.
#
# Prereq: an anchored stack (up.sh --variant anchoring | parallel-anchored; for
# parallel-anchored, channel case-001); curl, jq, docker. Only the test's own
# evidence and receipts are touched; changed receipt files are restored on exit.
# Side effect: it first re-creates the batcher with an empty BATCH_EPOCH (in
# network/compose/.env; the container's start time then names its batches), so
# no batch id of the test can already be on the ledger.
set -euo pipefail

GATEWAY="${GATEWAY_URL:-http://localhost:3000}"
BATCHER="${BATCHER_URL:-http://localhost:4001}"
TOKEN="${GLEIPNIR_TOKEN:-dev-token}"
RS="gleipnir-receipt-store"
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    *) echo "usage: tamper-test.sh [--out FILE]" >&2; exit 2 ;;
  esac
done
AUTH=(-H "authorization: Bearer ${TOKEN}" -H "content-type: application/json")

status="$(curl -fsS "${BATCHER}/status")" || { echo "[tamper] no batcher at ${BATCHER}: bring up an anchored variant first" >&2; exit 2; }
VARIANT="$(jq -r '.variant' <<<"${status}")"
CASE_FIELD="" CASE_QS="" SCOPE="shared"
if [ "${VARIANT}" = "parallel-anchored" ]; then
  CASE_FIELD=',"caseId":"case-001"'; CASE_QS="caseId=case-001"; SCOPE="case-001"
fi
EV="ev-tamper-$(date +%s)"

# Restore every receipt file this script set aside, whatever happens.
restore() {
  docker exec "${RS}" sh -c 'for f in /data/*.json.orig; do [ -e "$f" ] || continue; mv "$f" "${f%.orig}"; done' || true
}
trap restore EXIT
rs_js() { docker exec "${RS}" node -e "$1" "${@:2}"; }   # run JS inside the receipt store; argv[1..] = args
backup() { docker exec "${RS}" cp "/data/$1.json" "/data/$1.json.orig"; }
undo() { docker exec "${RS}" mv "/data/$1.json.orig" "/data/$1.json"; }

post() {   # $1 = method + path, $2 = body -> prints the 202 body, fails otherwise
  local resp code
  resp="$(curl -sS -w '\n%{http_code}' "${AUTH[@]}" -X "${1%% *}" "${GATEWAY}${1#* }" -d "$2")"
  code="${resp##*$'\n'}"
  [ "${code}" = "202" ] || { echo "[tamper] expected 202 from $1, got ${code}: ${resp%$'\n'*}" >&2; exit 2; }
  printf '%s' "${resp%$'\n'*}"
}
verify() {   # $1 = eventId -> "ok" | the verification reason (root-mismatch, missing-receipt, ...)
  local body
  body="$(curl -sS "${AUTH[@]}" "${GATEWAY}/api/v1/evidence/${EV}/verify?eventId=$1")" \
    || { echo "[tamper] the gateway does not answer verify" >&2; exit 2; }
  jq -r 'if .ok then "ok" else (.reason // "error") end' <<<"${body}"
}
trail() {   # -> the evidence's off-chain trail with proofs
  curl -fsS "${AUTH[@]}" "${GATEWAY}/api/v1/evidence/${EV}/audit?proofs=1${CASE_QS:+&${CASE_QS}}" \
    || { echo "[tamper] the gateway does not answer the trail read" >&2; exit 2; }
}
flush() {
  curl -fsS -X POST "${BATCHER}/flush" >/dev/null || { echo "[tamper] the batcher does not answer flush" >&2; exit 2; }
}
FAILS=0
expect() {   # $1 = what, $2 = got, $3 = documented outcome
  if [ "$2" = "$3" ]; then echo "[tamper] ${1}: ${2}"; else echo "[tamper] UNEXPECTED ${1}: ${2} (documented: ${3})" >&2; FAILS=$((FAILS + 1)); fi
}

echo "[tamper] variant=${VARIANT}: four events for ${EV}"
flush   # close any partial batch of earlier traffic, then a batcher whose batch ids are new:
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"   # compose, set_env_var
set_env_var BATCH_EPOCH ""
compose --profile anchoring --profile parallel-anchored up -d --force-recreate merkle-batcher >/dev/null
for _ in $(seq 1 30); do curl -fsS "${BATCHER}/healthz" >/dev/null 2>&1 && break; sleep 1; done
E=()
E+=("$(post "POST /api/v1/evidence" "{\"evidenceId\":\"${EV}\",\"identity\":{\"subject\":\"alice\"}${CASE_FIELD}}" | jq -r .eventId)")
E+=("$(post "POST /api/v1/evidence/${EV}/transfer" "{\"newCustodian\":\"bob\",\"reason\":\"handover\"${CASE_FIELD}}" | jq -r .eventId)")
E+=("$(post "POST /api/v1/evidence/${EV}/access" "{\"actor\":\"bob\",\"action\":\"view\"${CASE_FIELD}}" | jq -r .eventId)")
E+=("$(post "POST /api/v1/evidence/${EV}/access" "{\"actor\":\"carol\",\"action\":\"export\"${CASE_FIELD}}" | jq -r .eventId)")
flush   # closes the batch and waits for its root to commit

ok=0
for e in "${E[@]}"; do [ "$(verify "${e}")" = "ok" ] && ok=$((ok + 1)); done
expect "baseline: events that verify" "${ok}" "4"
expect "baseline: trail length" "$(trail | jq length)" "4"

# 1) changed event copy
backup "${E[0]}"
rs_js 'const fs=require("fs");const f="/data/"+process.argv[1]+".json";const r=JSON.parse(fs.readFileSync(f,"utf8"));r.event.actor="mallory";fs.writeFileSync(f,JSON.stringify(r));' "${E[0]}"
CHANGED_EVENT="$(verify "${E[0]}")"
expect "changed event copy -> verify" "${CHANGED_EVENT}" "root-mismatch"
undo "${E[0]}"
expect "changed event copy restored -> verify" "$(verify "${E[0]}")" "ok"

# 2) changed sibling path (needs a batch of two or more leaves)
PATH_LEN="$(rs_js 'process.stdout.write(String(JSON.parse(require("fs").readFileSync("/data/"+process.argv[1]+".json","utf8")).siblingPath.length));' "${E[1]}")"
CHANGED_PATH="skipped (single-leaf batch)"
if [ "${PATH_LEN}" -gt 0 ]; then
  backup "${E[1]}"
  rs_js 'const fs=require("fs");const f="/data/"+process.argv[1]+".json";const r=JSON.parse(fs.readFileSync(f,"utf8"));const h=r.siblingPath[0].hash;r.siblingPath[0].hash=(h[0]==="0"?"1":"0")+h.slice(1);fs.writeFileSync(f,JSON.stringify(r));' "${E[1]}"
  CHANGED_PATH="$(verify "${E[1]}")"
  expect "changed sibling path -> verify" "${CHANGED_PATH}" "root-mismatch"
  undo "${E[1]}"
fi

# 3) deleted receipt: the trail drops the event without a trace; the root's leafCount does not
BATCH_ID="$(trail | jq -r --arg e "${E[2]}" '.[] | select(.eventId == $e) | .proof.batchId')"
LEAF_COUNT="$(curl -fsS "${AUTH[@]}" "${GATEWAY}/api/v1/anchor-roots/${SCOPE}/${BATCH_ID}" | jq .leafCount)"
docker exec "${RS}" mv "/data/${E[2]}.json" "/data/${E[2]}.json.orig"
DELETED="$(verify "${E[2]}")"
expect "deleted receipt -> verify" "${DELETED}" "missing-receipt"
TRAIL_AFTER_DELETE="$(trail | jq length)"
expect "deleted receipt -> trail length (no error, one event fewer)" "${TRAIL_AFTER_DELETE}" "3"
IN_BATCH="$(trail | jq --arg b "${BATCH_ID}" '[.[] | select(.proof.batchId == $b)] | length')"
echo "[tamper] deleted receipt: root ${BATCH_ID} records leafCount ${LEAF_COUNT}, ${IN_BATCH} receipts of it remain"
undo "${E[2]}"

# 4) replay through the gateway: the same request again is a new event
NEW_ID="$(post "POST /api/v1/evidence/${EV}/access" "{\"actor\":\"carol\",\"action\":\"export\"${CASE_FIELD}}" | jq -r .eventId)"
flush
expect "replay via the gateway -> a new eventId" "$([ "${NEW_ID}" != "${E[3]}" ] && echo yes || echo no)" "yes"
TRAIL_AFTER_REPLAY="$(trail | jq length)"
expect "replay via the gateway -> trail length" "${TRAIL_AFTER_REPLAY}" "5"

# 5) replay into the batcher with the same eventId
EVENT_JSON="$(rs_js 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync("/data/"+process.argv[1]+".json","utf8")).event));' "${E[3]}")"
BATCH_BEFORE="$(trail | jq -r --arg e "${E[3]}" '.[] | select(.eventId == $e) | .proof.batchId')"
enqueue() { curl -sS -o /dev/null -w '%{http_code}' -X POST -H "content-type: application/json" "${BATCHER}/events" -d "${EVENT_JSON}"; }
FIRST="$(enqueue)"; SECOND="$(enqueue)"
expect "replay into the batcher -> first enqueue" "${FIRST}" "202"
expect "replay into the batcher -> same eventId again in the open batch" "${SECOND}" "409"
flush
BATCH_AFTER="$(trail | jq -r --arg e "${E[3]}" '.[] | select(.eventId == $e) | .proof.batchId')"
expect "replay into the batcher -> receipt now witnesses a later batch" \
  "$([ "${BATCH_AFTER}" != "${BATCH_BEFORE}" ] && echo yes || echo no)" "yes"
expect "replay into the batcher -> the replayed event verifies against the new root" "$(verify "${E[3]}")" "ok"
expect "replay into the batcher -> trail still lists it once" "$(trail | jq length)" "5"

RESULT="$(jq -n --arg variant "${VARIANT}" --arg ev "${EV}" --argjson events "$(printf '%s\n' "${E[@]}" | jq -R . | jq -s .)" \
  --arg ce "${CHANGED_EVENT}" --arg cp "${CHANGED_PATH}" --arg del "${DELETED}" \
  --argjson trailDel "${TRAIL_AFTER_DELETE}" --argjson leaf "${LEAF_COUNT}" --argjson inBatch "${IN_BATCH}" \
  --arg newId "${NEW_ID}" --argjson trailRep "${TRAIL_AFTER_REPLAY}" --arg first "${FIRST}" --arg second "${SECOND}" \
  --arg before "${BATCH_BEFORE}" --arg after "${BATCH_AFTER}" --argjson fails "${FAILS}" \
  '{test: "receipt-tamper", variant: $variant, evidenceId: $ev, eventIds: $events,
    changedEventCopy: {verify: $ce, detected: ($ce == "root-mismatch")},
    changedSiblingPath: {verify: $cp, detected: ($cp == "root-mismatch")},
    deletedReceipt: {verify: $del, trailEvents: $trailDel, rootLeafCount: $leaf, receiptsLeftInBatch: $inBatch,
                     detectedByTrail: false},
    replayViaGateway: {newEventId: $newId, trailEvents: $trailRep, recognisedAsReplay: false},
    replayIntoBatcher: {firstEnqueue: ($first | tonumber), sameBatchAgain: ($second | tonumber),
                        receiptBatchBefore: $before, receiptBatchAfter: $after,
                        witnessOverwritten: ($before != $after)},
    unexpected: $fails}')"
[ -n "${OUT}" ] && printf '%s\n' "${RESULT}" > "${OUT}"
printf '%s\n' "${RESULT}"
if [ "${FAILS}" = "0" ]; then echo "[tamper] RESULT: every outcome is the documented one"; exit 0; fi
echo "[tamper] RESULT: ${FAILS} outcome(s) differ from the documented behaviour" >&2
exit 1
