# Build from repo root:
#   docker build -f coral-agents/audit-seller/Dockerfile -t audit-seller:0.1.0 .
#
# The three seller personas (audit-discounter / audit-tls-specialist / audit-premium) all reuse this
# image. It builds the @auditmesh workspace packages (shared -> authorization -> audit-service) in
# dependency order, then the agent. The prebaked report is baked in for REPORT_SOURCE=prebaked.
#
# NOTE: `live` mode shells out to the `strix` CLI, which itself needs a Docker sandbox + an LLM key —
# run REPORT_SOURCE=live only where Strix + Docker-in-Docker are available. `prebaked` (default) needs
# neither. Settlement is live on devnet regardless of mode.

FROM node:20-alpine AS builder
WORKDIR /app

# ── @pay/agent-runtime ────────────────────────────────────────────────────────
COPY packages/agent-runtime/package.json ./packages/agent-runtime/
RUN cd packages/agent-runtime && npm install --ignore-scripts
COPY packages/agent-runtime/tsconfig.json ./packages/agent-runtime/
COPY packages/agent-runtime/src/ ./packages/agent-runtime/src/
RUN cd packages/agent-runtime && npx tsc

# ── @auditmesh/shared ─────────────────────────────────────────────────────────
COPY packages/shared/package.json ./packages/shared/
RUN cd packages/shared && npm install --ignore-scripts
COPY packages/shared/tsconfig.json packages/shared/tsconfig.build.json ./packages/shared/
COPY packages/shared/src/ ./packages/shared/src/
RUN cd packages/shared && npx tsc -p tsconfig.build.json

# ── @auditmesh/authorization (depends on shared) ──────────────────────────────
COPY packages/authorization/package.json ./packages/authorization/
RUN cd packages/authorization && npm install --ignore-scripts --install-links
COPY packages/authorization/tsconfig.json packages/authorization/tsconfig.build.json ./packages/authorization/
COPY packages/authorization/src/ ./packages/authorization/src/
RUN cd packages/authorization && npx tsc -p tsconfig.build.json

# ── @auditmesh/audit-service (depends on shared + authorization) ──────────────
COPY packages/audit-service/package.json ./packages/audit-service/
RUN cd packages/audit-service && npm install --ignore-scripts --install-links
COPY packages/audit-service/tsconfig.json packages/audit-service/tsconfig.build.json ./packages/audit-service/
COPY packages/audit-service/src/ ./packages/audit-service/src/
RUN cd packages/audit-service && npx tsc -p tsconfig.build.json

# ── the agent ─────────────────────────────────────────────────────────────────
COPY coral-agents/audit-seller/package.json ./coral-agents/audit-seller/
RUN cd coral-agents/audit-seller && npm install --ignore-scripts --install-links
COPY coral-agents/audit-seller/tsconfig.json ./coral-agents/audit-seller/
COPY coral-agents/audit-seller/src/ ./coral-agents/audit-seller/src/
RUN cd coral-agents/audit-seller && npx tsc

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/coral-agents/audit-seller/dist ./dist
COPY --from=builder /app/coral-agents/audit-seller/node_modules ./node_modules
# Prebaked real Strix report served by REPORT_SOURCE=prebaked (the default). PREBAKED_REPORT_PATH
# defaults to /app/reports/prebaked-juice-shop.json.
COPY reports/prebaked-juice-shop.json ./reports/prebaked-juice-shop.json

CMD ["node", "dist/index.js"]
