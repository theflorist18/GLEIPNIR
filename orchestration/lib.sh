#!/usr/bin/env bash
# Shared helpers for the GLEIPNIR orchestration scripts (docs/CONTRACTS.md §11).
# Sourced by up.sh / provision-channel.sh / down.sh etc. All Fabric admin ops run
# inside the `cli` fabric-tools container, which mounts the repo at /opt/gleipnir.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_DIR="${REPO_ROOT}/network/compose"
CC_NAME="evidence"
CC_VERSION="1.0"
CC_LABEL="evidence_1.0"

# In-container paths (cli mounts the repo at /opt/gleipnir).
CTN_REPO="/opt/gleipnir"
CTN_CFG="${CTN_REPO}/network/configtx"
CTN_ORG="${CTN_REPO}/network/organizations"
CTN_ARTIFACTS="${CTN_REPO}/network/channel-artifacts"

# Orderer admin endpoints (container hostnames : admin ports) — all three.
ORDERER_ADMINS=("orderer0.example.com:7053" "orderer1.example.com:8053" "orderer2.example.com:9053")
ORDERER0="orderer0.example.com:7050"
ORDERER0_CA="${CTN_ORG}/ordererOrganizations/example.com/orderers/orderer0.example.com/tls/ca.crt"
ORDERER0_ADMIN_CERT="${CTN_ORG}/ordererOrganizations/example.com/orderers/orderer0.example.com/tls/server.crt"
ORDERER0_ADMIN_KEY="${CTN_ORG}/ordererOrganizations/example.com/orderers/orderer0.example.com/tls/server.key"

compose() {
  docker compose -p gleipnir --project-directory "${COMPOSE_DIR}" \
    -f "${COMPOSE_DIR}/compose-net.yaml" \
    -f "${COMPOSE_DIR}/compose-ca.yaml" \
    -f "${COMPOSE_DIR}/compose-services.yaml" "$@"
}

# Run a command inside the cli container.
cli() {
  compose exec -T cli bash -c "$1"
}

# Export peer CLI env for a given org inside the cli container (the setGlobals idiom).
# Prints a shell prelude to be prepended to a cli() command.
peer_env() {
  local org="$1"
  case "${org}" in
    org1)
      cat <<EOF
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_ADDRESS=peer0.org1.example.com:7051
export CORE_PEER_TLS_ROOTCERT_FILE=${CTN_ORG}/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${CTN_ORG}/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export FABRIC_CFG_PATH=${CTN_REPO}/network
EOF
      ;;
    org2)
      cat <<EOF
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org2MSP
export CORE_PEER_ADDRESS=peer0.org2.example.com:9051
export CORE_PEER_TLS_ROOTCERT_FILE=${CTN_ORG}/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${CTN_ORG}/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp
export FABRIC_CFG_PATH=${CTN_REPO}/network
EOF
      ;;
    anchor)
      cat <<EOF
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=AnchorClientMSP
export CORE_PEER_ADDRESS=peer0.anchor.example.com:11051
export CORE_PEER_TLS_ROOTCERT_FILE=${CTN_ORG}/peerOrganizations/anchor.example.com/peers/peer0.anchor.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${CTN_ORG}/peerOrganizations/anchor.example.com/users/Admin@anchor.example.com/msp
export FABRIC_CFG_PATH=${CTN_REPO}/network
EOF
      ;;
    *) echo "unknown org ${org}" >&2; return 1 ;;
  esac
}

# Generate a channel genesis block and join all three orderers (assert HTTP 201).
# args: <channel-id> <configtx-profile>
create_channel() {
  local channel="$1" profile="$2"
  echo "==> creating channel ${channel} (profile ${profile})"
  cli "mkdir -p ${CTN_ARTIFACTS} && FABRIC_CFG_PATH=${CTN_CFG} configtxgen \
    -profile ${profile} -channelID ${channel} \
    -outputBlock ${CTN_ARTIFACTS}/${channel}.block"

  for admin in "${ORDERER_ADMINS[@]}"; do
    echo "    osnadmin channel join ${channel} -> ${admin}"
    cli "osnadmin channel join --channelID ${channel} \
      --config-block ${CTN_ARTIFACTS}/${channel}.block \
      -o ${admin} \
      --ca-file ${ORDERER0_CA} \
      --client-cert ${ORDERER0_ADMIN_CERT} \
      --client-key ${ORDERER0_ADMIN_KEY} 2>&1 | tee /tmp/osnadmin.out
      grep -q 'Status: 201' /tmp/osnadmin.out"
  done
}

# Join a peer (org) to a channel. args: <org> <channel>
join_peer() {
  local org="$1" channel="$2"
  echo "==> joining peer0-${org} to ${channel}"
  cli "$(peer_env "${org}")
peer channel join -b ${CTN_ARTIFACTS}/${channel}.block"
}

# Package + install ccaas chaincode, returning the package id (written to stdout).
# args: <ccaas-service-host> <pkg-file>
package_ccaas() {
  local ccaas_host="$1" pkg="$2"
  # channel-artifacts must already exist here: installs are hoisted before the
  # first create_channel (F46), whose mkdir used to cover this on a clean tree
  # (audit F73, first live bring-up).
  cli "set -e
mkdir -p ${CTN_ARTIFACTS}
tmp=\$(mktemp -d)
printf '{\"address\":\"%s:9999\",\"dial_timeout\":\"10s\",\"tls_required\":false}' '${ccaas_host}' > \$tmp/connection.json
printf '{\"type\":\"ccaas\",\"label\":\"${CC_LABEL}\"}' > \$tmp/metadata.json
tar -C \$tmp -czf \$tmp/code.tar.gz connection.json
tar -C \$tmp -czf ${CTN_REPO}/network/channel-artifacts/${CC_NAME}-${ccaas_host}.tar.gz metadata.json code.tar.gz
peer lifecycle chaincode calculatepackageid ${CTN_REPO}/network/channel-artifacts/${CC_NAME}-${ccaas_host}.tar.gz"
}

# Write/replace a KEY=VALUE line in network/compose/.env (on the host).
set_env_var() {
  local key="$1" value="$2" file="${COMPOSE_DIR}/.env"
  if grep -q "^${key}=" "${file}"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "${file}" && rm -f "${file}.bak"
  else
    echo "${key}=${value}" >> "${file}"
  fi
}

# Wait for a host-published operations /healthz to answer (peers/orderers).
# Peers register a docker-daemon health check that can never pass here: ccaas
# peers have no docker socket BY DESIGN, so after startup their healthz is a
# permanent 503 whose only failed check is "docker" — a bare 200 is just the
# pre-registration startup window (audit F74, first parallel-anchored
# bring-up). Ready therefore = status OK, or failed_checks == ["docker"].
wait_healthz() {
  local port="$1" name="$2" tries=0 body
  until body="$(curl -sS --max-time 3 "http://localhost:${port}/healthz" 2>/dev/null)" && \
        echo "${body}" | jq -e '(.status == "OK") or ([.failed_checks[]?.component] == ["docker"])' >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "${tries}" -gt 60 ]; then
      echo "timeout waiting for ${name} (:${port}/healthz)" >&2
      return 1
    fi
    sleep 2
  done
  echo "    ${name} healthy (:${port})"
}
