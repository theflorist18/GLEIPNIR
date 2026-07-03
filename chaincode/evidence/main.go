package main

import (
	"log"
	"os"

	"github.com/hyperledger/fabric-chaincode-go/v2/shim"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// Chaincode-as-a-service entry point (CONTRACTS sect. 3). The peer never
// compiles this chaincode; it runs as its own service and the peer dials it
// using the ccaas external builder. Reads CHAINCODE_ID (the package ID) and
// CHAINCODE_SERVER_ADDRESS (e.g. 0.0.0.0:9999) from the environment.
func main() {
	cc, err := contractapi.NewChaincode(&EvidenceContract{})
	if err != nil {
		log.Panicf("error creating evidence chaincode: %v", err)
	}

	server := &shim.ChaincodeServer{
		CCID:    os.Getenv("CHAINCODE_ID"),
		Address: os.Getenv("CHAINCODE_SERVER_ADDRESS"),
		CC:      cc,
		// No peer<->chaincode TLS: GLEIPNIR runs on a single host and single
		// Docker network, so the ccaas link is not exposed off-box.
		TLSProps: shim.TLSProperties{Disabled: true},
	}

	if err := server.Start(); err != nil {
		log.Panicf("error starting evidence chaincode server: %v", err)
	}
}
