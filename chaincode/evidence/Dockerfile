# Chaincode-as-a-Service image for the GLEIPNIR evidence contract.
# The peer never compiles this chaincode; it runs here as its own gRPC service
# and the peer dials it via the ccaas external builder (docs/CONTRACTS.md §3).
#
# The chaincode is pinned to Go 1.25.5, which is why ccaas is used: the peer's
# fabric-ccenv:2.5 image builds with a different Go version
# (docs/research/fabric-2.5.md §2).
FROM golang:1.25.5 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /bin/evidence-cc .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /bin/evidence-cc /bin/evidence-cc
# CHAINCODE_ID (package ID) and CHAINCODE_SERVER_ADDRESS are injected at runtime
# by the compose service / orchestration (docs/CONTRACTS.md §3, §8).
EXPOSE 9999
ENTRYPOINT ["/bin/evidence-cc"]
