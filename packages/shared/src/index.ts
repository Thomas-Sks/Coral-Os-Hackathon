// @auditmesh/shared — the contracts every AuditMesh module agrees on.
//
//   scope/          the rules of engagement (what a seller may do)
//   report/         the vulnerability report schema — the paid artifact
//   authorization/  the signed, scoped consent payloads (types + canonicalization)
//   protocol/       AuditMesh thread messages layered on the starter's market protocol
//   config/         validated tunables + the hardcoded target allowlist (the hard boundary)
//   logging/        correlation-scoped structured logging (names the decision-to-pay moment)

export * from './scope.js'
export * from './report.js'
export * from './authorization.js'
export * from './protocol.js'
export * from './config.js'
export * from './cost.js'
export * from './logging.js'
