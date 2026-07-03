#!/usr/bin/env bash
# Build the two AuditMesh agent images coral-server launches (from repo root so they bundle packages/).
# The three seller personas (audit-discounter / audit-tls-specialist / audit-premium) all reuse the
# audit-seller image. Run once before the market — only needed if you change the agents or packages.
#
# Usage: bash build-audit-agents.sh          (build both)
#        bash build-audit-agents.sh seller   (audit-seller only)
#        bash build-audit-agents.sh buyer    (audit-buyer only)

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

build_seller() {
  echo "==> Building audit-seller:0.1.0"
  docker build -f "$ROOT/coral-agents/audit-seller/Dockerfile" -t audit-seller:0.1.0 "$ROOT"
  echo "    audit-seller:0.1.0 done (audit-discounter / audit-tls-specialist / audit-premium reuse it)"
}

build_buyer() {
  echo "==> Building audit-buyer:0.1.0"
  docker build -f "$ROOT/coral-agents/audit-buyer/Dockerfile" -t audit-buyer:0.1.0 "$ROOT"
  echo "    audit-buyer:0.1.0 done"
}

case "${1:-all}" in
  seller) build_seller ;;
  buyer)  build_buyer ;;
  all)
    build_seller
    build_buyer
    echo ""
    echo "Both AuditMesh images built. Bring up the coordinator + target, then launch the market:"
    echo "  docker-compose -f docker-compose.auditmesh.yml up -d"
    echo "  npm run start:audit --prefix examples/marketplace"
    ;;
  *) echo "Usage: bash build-audit-agents.sh [seller|buyer|all]"; exit 1 ;;
esac
