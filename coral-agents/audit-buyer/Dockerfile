# Build from repo root:
#   docker build -f coral-agents/audit-buyer/Dockerfile -t audit-buyer:0.1.0 .
#
# Builds the @auditmesh workspace packages (shared -> authorization) in dependency order, then the
# buyer agent. The buyer does not run Strix, so it does not need @auditmesh/audit-service.

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

# ── the agent ─────────────────────────────────────────────────────────────────
COPY coral-agents/audit-buyer/package.json ./coral-agents/audit-buyer/
RUN cd coral-agents/audit-buyer && npm install --ignore-scripts --install-links
COPY coral-agents/audit-buyer/tsconfig.json ./coral-agents/audit-buyer/
COPY coral-agents/audit-buyer/src/ ./coral-agents/audit-buyer/src/
RUN cd coral-agents/audit-buyer && npx tsc

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/coral-agents/audit-buyer/dist ./dist
COPY --from=builder /app/coral-agents/audit-buyer/node_modules ./node_modules

CMD ["node", "dist/index.js"]
