#!/usr/bin/env bash
# Chunk-7 environment workaround (docs/audit/chunk-7-live-e2e.md §Environment):
# pre-build the compose images with the host MITM-proxy CA injected at BUILD
# time only. The tracked Dockerfiles are citation-pinned and must not change,
# so wrappers are GENERATED from them (awk-inserted CA lines only) and the CA
# is supplied via --build-context — it never enters the repo. Tags match the
# compose-v2 defaults (<project>-<service>) so `compose up` skips building.
#
# Re-run only if the engine's image store is reset (down.sh --wipe keeps
# images). Not product code — dev-host workaround; on a proxy-free host the
# tracked Dockerfiles build as-is and this script is unnecessary.
#
#   GLEIPNIR_REPO=/path/to/repo GLEIPNIR_CA_BUNDLE=/path/to/ca.crt \
#     bash docs/audit/chunk-7-build-images.sh
set -euo pipefail
REPO="${GLEIPNIR_REPO:-/c/theflorist18/Gleipnir}"
CA_BUNDLE="${GLEIPNIR_CA_BUNDLE:-/c/Users/LENOVO/gleipnir-ca-bundle.crt}"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
mkdir -p "${WORK}/certs" "${WORK}/df"
cp "${CA_BUNDLE}" "${WORK}/certs/gleipnir-ca-bundle.crt"

gen_node() { # node:20.19-alpine images — CA after first WORKDIR
  awk '{print} !d && /^WORKDIR/ {print "COPY --from=certs gleipnir-ca-bundle.crt /etc/gleipnir-ca.crt"; print "ENV NODE_EXTRA_CA_CERTS=/etc/gleipnir-ca.crt"; d=1}' "$1"
}
gen_go() {   # golang:1.25.5 build stage — CA into the debian trust store
  awk '{print} !d && /^FROM golang/ {print "COPY --from=certs gleipnir-ca-bundle.crt /usr/local/share/ca-certificates/gleipnir-ca.crt"; print "RUN update-ca-certificates"; d=1}' "$1"
}

gen_node "${REPO}/gateway/Dockerfile"                 > "${WORK}/df/gateway.Dockerfile"
gen_node "${REPO}/frontend/Dockerfile"                > "${WORK}/df/frontend.Dockerfile"
gen_node "${REPO}/services/merkle-batcher/Dockerfile" > "${WORK}/df/merkle-batcher.Dockerfile"
gen_node "${REPO}/services/receipt-store/Dockerfile"  > "${WORK}/df/receipt-store.Dockerfile"
gen_node "${REPO}/services/verification/Dockerfile"   > "${WORK}/df/verification.Dockerfile"
gen_node "${REPO}/services/anchor-client/Dockerfile"  > "${WORK}/df/anchor-client.Dockerfile"
gen_go   "${REPO}/chaincode/evidence/Dockerfile"      > "${WORK}/df/ccaas-evidence.Dockerfile"

build() { # $1 tag, $2 dockerfile, $3 context
  echo "=====> building $1"
  docker build --build-context certs="${WORK}/certs" -f "$2" -t "$1" "$3"
  echo "=====> OK $1"
}

build gleipnir-gateway        "${WORK}/df/gateway.Dockerfile"        "${REPO}/gateway"
build gleipnir-frontend       "${WORK}/df/frontend.Dockerfile"       "${REPO}/frontend"
build gleipnir-ccaas-evidence "${WORK}/df/ccaas-evidence.Dockerfile" "${REPO}/chaincode/evidence"
docker tag gleipnir-ccaas-evidence gleipnir-ccaas-evidence-anchor
build gleipnir-merkle-batcher "${WORK}/df/merkle-batcher.Dockerfile" "${REPO}/services/merkle-batcher"
build gleipnir-receipt-store  "${WORK}/df/receipt-store.Dockerfile"  "${REPO}/services/receipt-store"
build gleipnir-verification   "${WORK}/df/verification.Dockerfile"   "${REPO}/services/verification"
build gleipnir-anchor-client  "${WORK}/df/anchor-client.Dockerfile"  "${REPO}/services/anchor-client"
echo "ALL-IMAGES-BUILT"
