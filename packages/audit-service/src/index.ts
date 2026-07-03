// @auditmesh/audit-service — the sold artifact.
//
//   deliver/      runAudit() + deliverService(): authz gate → allowlist → Strix/prebaked → report
//   strix/        the Strix subprocess wrapper (spawn, timeout, run-dir discovery) — no exploit logic
//   parser/       tolerant Strix-output → report-schema mapping (pure, tested)
//   instruction/  build Strix's rules of engagement from the granted scope
//   prebaked/     replay a stored REAL Strix report for a deterministic filmed demo

export * from './deliver.js'
export * from './strix.js'
export * from './parser.js'
export * from './instruction.js'
export * from './prebaked.js'
