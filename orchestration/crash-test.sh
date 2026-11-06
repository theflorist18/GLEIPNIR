#!/usr/bin/env bash
# GLEIPNIR batcher crash test (anchored variants): what happens to events the
# gateway accepted (HTTP 202) when the merkle-batcher dies before their batch
# closes?
#
#   crash-test.sh [--events K] [--out FILE]
#
# 1. Sends K events (default 5, fewer than the batch size) for one new evidence
#    through the gateway; each is accepted (202) into the batcher's open batch.
# 2. Kills the batcher (SIGKILL: a crash, not a graceful stop) and starts the
#    same container again.
# 3. Flushes the restarted batcher and checks, for every accepted event, the
#    receipt (verification service), the off-chain trail and the batch's root.
#
# The batcher keeps an open batch in its process memory only, so the expected
# (documented) outcome is: no receipt, no trail entry and no root for any of the
# K events. Exits 0 when that is what it finds, 1 when anything survived (the
# documentation would then be wrong), 2 when the stack gives no usable answer.
# It also records whether the restarted container kept its batch-id epoch: with
# BATCH_EPOCH fixed in its environment the restarted process numbers its batches
# from b000000 again, so its next batches reuse ids whose roots may already be
# on the ledger.
#
# Side effects: before the test it re-creates the batcher with a new fixed
# BATCH_EPOCH (crash-test-<unix time>, written to network/compose/.env), so the
# test's batch id cannot already be on the ledger; when the restart kept that
# epoch it finally re-creates the batcher with an empty BATCH_EPOCH (the
# container's start time), so later writes on this stack still anchor.
#
# Prereq: an anchored stack (up.sh --variant anchoring | parallel-anchored; for
# parallel-anchored, channel case-001); curl, jq, docker. The test's evidence
# id is new on every run; nothing else on the ledger is touched.
set -euo pipefail

GATEWAY="${GATEWAY_URL:-http://localhost:3000}"
BATCHER="${BATCHER_URL:-http://localhost:4001}"
TOKEN="${GLEIPNIR_TOKEN:-dev-token}"
CONTAINER="gleipnir-merkle-batcher"
K=5
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --events) K="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "usage: crash-test.sh [--events K] [--out FILE]" >&2; exit 2 ;;
  esac
done
AUTH=(-H "authorization: Bearer ${TOKEN}" -H "content-type: application/json")

status="$(curl -fsS "${BATCHER}/status")" || { echo "[crash] no batcher at ${BATCHER}: bring up an anchored variant first" >&2; exit 2; }
VARIANT="$(jq -r '.variant' <<<"${status}")"
SIZE="$(jq -r '.batchSize' <<<"${status}")"
if [ "${K}" -ge "${SIZE}" ]; then
  echo "[crash] --events ${K} would fill a batch of ${SIZE} and close it; use fewer than ${SIZE}" >&2; exit 2
fi
CASE_FIELD="" SCOPE="shared"
if [ "${VARIANT}" = "parallel-anchored" ]; then CASE_FIELD=',"caseId":"case-001"'; SCOPE="case-001"; fi
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"   # compose, set_env_var
recreate_batcher() {   # $1 = BATCH_EPOCH for the new container ("" = its start time)
  set_env_var BATCH_EPOCH "$1"
  compose --profile anchoring --profile parallel-anchored up -d --force-recreate merkle-batcher >/dev/null
  for _ in $(seq 1 30); do curl -fsS "${BATCHER}/healthz" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "[crash] ${CONTAINER} did not come back" >&2; exit 2
}
# Close any partial batch left by earlier traffic, then start the batcher on an epoch no batch on the
# ledger has used (fixed in its environment, as in a benchmark run), so the test's batch id is new.
curl -fsS -X POST "${BATCHER}/flush" >/dev/null || { echo "[crash] flush failed" >&2; exit 2; }
recreate_batcher "crash-test-$(date +%s)"
EV="ev-crash-$(date +%s)"
echo "[crash] variant=${VARIANT} batchSize=${SIZE}: sending ${K} events for ${EV}"

EVENTS="[]"
accept() {   # $1 = method + path, $2 = body; appends the 202's {eventId, batchId} to EVENTS
  local resp code
  resp="$(curl -sS -w '\n%{http_code}' "${AUTH[@]}" -X "${1%% *}" "${GATEWAY}${1#* }" -d "$2")"
  code="${resp##*$'\n'}"
  [ "${code}" = "202" ] || { echo "[crash] expected 202 from $1, got ${code}: ${resp%$'\n'*}" >&2; exit 2; }
  EVENTS="$(jq -c --argjson e "${resp%$'\n'*}" '. + [{eventId: $e.eventId, batchId: $e.batchId}]' <<<"${EVENTS}")"
}
accept "POST /api/v1/evidence" "{\"evidenceId\":\"${EV}\",\"identity\":{\"subject\":\"alice\"}${CASE_FIELD}}"
for i in $(seq 2 "${K}"); do
  accept "POST /api/v1/evidence/${EV}/access" "{\"actor\":\"alice\",\"action\":\"view-${i}\"${CASE_FIELD}}"
done
BATCH_ID="$(jq -r '.[0].batchId' <<<"${EVENTS}")"
EPOCH_BEFORE="${BATCH_ID#"${SCOPE}"-}"; EPOCH_BEFORE="${EPOCH_BEFORE%-b*}"   # batchId = <scope>-<epoch>-b<seq>
[ "$(jq --arg b "${BATCH_ID}" '[.[] | select(.batchId != $b)] | length' <<<"${EVENTS}")" = "0" ] || {
  echo "[crash] the events were split over several batches; nothing to test" >&2; exit 2; }

open="$(curl -fsS "${BATCHER}/status" | jq --arg s "${SCOPE}" --arg b "${BATCH_ID}" '{depth: (.queues[$s] // 0), closed: ([.batches[] | select(.batchId == $b)] | length)}')"
echo "[crash] before the crash: open batch ${BATCH_ID} holds $(jq .depth <<<"${open}") events, closed copies: $(jq .closed <<<"${open}")"
[ "$(jq .closed <<<"${open}")" = "0" ] || { echo "[crash] the batch closed before the crash; nothing to test" >&2; exit 2; }

echo "[crash] SIGKILL ${CONTAINER}, then start it again"
docker kill --signal KILL "${CONTAINER}" >/dev/null
docker start "${CONTAINER}" >/dev/null
for _ in $(seq 1 30); do curl -fsS "${BATCHER}/healthz" >/dev/null 2>&1 && break; sleep 1; done
after="$(curl -fsS -X POST "${BATCHER}/flush")" || { echo "[crash] the restarted batcher does not answer" >&2; exit 2; }
EPOCH_AFTER="$(docker exec "${CONTAINER}" printenv BATCH_EPOCH 2>/dev/null || true)"
echo "[crash] after the restart: open queues $(jq -c '.queues' <<<"${after}"), batches $(jq '.batches | length' <<<"${after}")"

survived() {   # $1 = URL -> 0 (gone: 404) | 1 (still there: 2xx); anything else is no answer at all
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$1")"
  case "${code}" in
    404) echo 0 ;;
    2??) echo 1 ;;
    *) echo "[crash] ${1} answered HTTP ${code}: the stack is not healthy, no verdict" >&2; exit 2 ;;
  esac
}
receipts=0 trail=0 roots=0
while read -r eid; do
  s="$(survived "${GATEWAY}/api/v1/evidence/${EV}/verify?eventId=${eid}")"   # set -e: exit 2 stops here
  receipts=$((receipts + s))
done < <(jq -r '.[].eventId' <<<"${EVENTS}")
trail="$(curl -fsS "${AUTH[@]}" "${GATEWAY}/api/v1/evidence/${EV}/audit${CASE_FIELD:+?caseId=case-001}")" \
  || { echo "[crash] the gateway does not answer the trail read" >&2; exit 2; }
trail="$(jq 'length' <<<"${trail}")"
roots="$(survived "${GATEWAY}/api/v1/anchor-roots/${SCOPE}/${BATCH_ID}")"

# The restarted process's epoch: from its env when fixed there, else its start time (differs).
REUSED="false"
[ -n "${EPOCH_AFTER}" ] && [ "${EPOCH_AFTER}" = "${EPOCH_BEFORE}" ] && REUSED="true"
RESULT="$(jq -n --arg variant "${VARIANT}" --argjson size "${SIZE}" --argjson k "${K}" --arg ev "${EV}" \
  --arg batch "${BATCH_ID}" --argjson receipts "${receipts}" --argjson trail "${trail}" --argjson roots "${roots}" \
  --arg before "${EPOCH_BEFORE}" --arg after "${EPOCH_AFTER}" --argjson reused "${REUSED}" --argjson events "${EVENTS}" \
  '{test: "batcher-crash", variant: $variant, batchSize: $size, evidenceId: $ev, openBatchId: $batch,
    accepted: $k, survivingReceipts: $receipts, survivingTrailEvents: $trail, survivingRoots: $roots,
    lost: ($receipts == 0 and $trail == 0 and $roots == 0), epochBefore: $before,
    epochAfterRestart: (if $after == "" then null else $after end), restartReusesBatchIds: $reused,
    events: $events}')"
[ -n "${OUT}" ] && printf '%s\n' "${RESULT}" > "${OUT}"
printf '%s\n' "${RESULT}"

if [ "${REUSED}" = "true" ]; then
  echo "[crash] note: the restarted batcher kept BATCH_EPOCH=${EPOCH_AFTER}, so it numbers batches from b000000" \
       "again and can reuse batch ids whose roots are already on the ledger"
  # Leave the stack usable: recreate the batcher with an epoch of its own (empty = its start time).
  recreate_batcher ""
  echo "[crash] recreated ${CONTAINER} with a fresh epoch, so later batches cannot collide"
fi
if [ "${receipts}" = "0" ] && [ "${trail}" = "0" ] && [ "${roots}" = "0" ]; then
  echo "[crash] RESULT: ${K} events accepted (202), 0 recoverable after the crash — no receipt, no trail entry, no root"
  exit 0
fi
echo "[crash] UNEXPECTED: receipts ${receipts}, trail events ${trail}, roots ${roots} survived the crash" >&2
exit 1
