// @auditmesh/authorization — the on-chain-enforced consent layer.
//
//   challenge/  domain-control: publish + live-verify a nonce (well-known or DNS TXT)
//   sign/       Ed25519 signing + offline signature/hash verification (Solana keypair)
//   issue/      the buyer's flow: assemble + sign a scoped grant
//   grant/      base64url transport for handing the grant over the CoralOS thread
//   verifier/   the enforced gate: signature + allowlist + expiry + scope + LIVE domain control
//   hash/       authorization hash + the escrow-reference binding (on-chain "was this authorized?")

export * from './hash.js'
export * from './sign.js'
export * from './challenge.js'
export * from './issue.js'
export * from './grant.js'
export * from './verifier.js'
