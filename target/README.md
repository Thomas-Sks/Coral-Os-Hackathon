# AuditMesh pentest target

This directory is the **bundled, self-hosted pentest target** that AuditMesh scans.
It is a deliberately-vulnerable web app fronted by a small nginx reverse proxy.

## What's here

| Piece | Role |
| --- | --- |
| `juice-shop` (OWASP Juice Shop, `bkimminich/juice-shop`, :3000) | The deliberately-vulnerable app under test. |
| `target-frontdoor` (nginx `1.27-alpine`, :80 → host :8899) | The allowlisted front-door: serves the auth token and proxies everything else to Juice Shop. |
| `frontdoor/nginx.conf` | The front-door config. |
| `.well-known/auditmesh-authz.txt` | The domain-control token file (placeholder until published). |
| `write-token.mjs` | Publishes a nonce into the token file. |
| `docker-compose.target.yml` | Compose fragment that runs the two services. |

## The front-door / well-known design — and why

AuditMesh's domain-control authorization challenge fetches:

```
GET http://<target>/.well-known/auditmesh-authz.txt
```

and requires the body to contain `auditmesh-authz=<nonce>`.

**Juice Shop does not serve arbitrary `/.well-known/*` paths**, so it cannot answer
that challenge on its own. We therefore put an nginx front-door in front of it that:

1. serves `GET /.well-known/auditmesh-authz.txt` straight from the mounted file
   `.well-known/auditmesh-authz.txt` (as `text/plain`, `Cache-Control: no-cache`,
   clean 404 if the file is missing), and
2. reverse-proxies **everything else** to `http://juice-shop:3000`, including
   socket.io websocket upgrades.

The front-door is the host AuditMesh points at; Juice Shop stays behind it on the
internal compose network.

## Allowlist (must stay in sync)

AuditMesh will only ever scan a host on its hardcoded allowlist. This target is
built to match that list exactly. The source of truth is
`TARGET_ALLOWLIST` in **`packages/shared/src/config.ts`** (a frozen constant — do
not edit it):

```
http://localhost:8899        # front-door published to the host (this compose)
http://127.0.0.1:8899
http://target-frontdoor      # front-door, internal compose network (port 80)
http://target-frontdoor:80
http://juice-shop:3000       # Juice Shop directly, internal compose network
http://localhost:3000        # Juice Shop for a bare local dev run
```

That is why the front-door publishes on host port **8899** and the internal
compose hostnames are exactly **`target-frontdoor`** (nginx :80) and
**`juice-shop`** (:3000). If you change ports or service names here, you must keep
them consistent with `TARGET_ALLOWLIST` or scans will be rejected at the boundary.

## Run standalone

From inside this `target/` directory:

```bash
docker-compose -f docker-compose.target.yml up
```

Then the target is reachable at <http://localhost:8899>. (The root harness compose
also includes these same services, so a full-stack run does not need this step
separately.)

## Publish the domain-control token

`write-token.mjs` writes `auditmesh-authz=<nonce>\n` into
`.well-known/auditmesh-authz.txt`, resolving the path relative to the script (not
your cwd). nginx serves the updated file immediately (mounted read-only, no
caching).

```bash
# Write a specific nonce:
node write-token.mjs my-known-nonce

# Or generate one, write it, and capture the printed nonce in a shell var:
NONCE=$(node write-token.mjs)
echo "published nonce: $NONCE"
```

The placeholder value shipped in the repo is `auditmesh-authz=REPLACE_ME_AT_DEMO_TIME`;
the demo harness overwrites it with a real nonce at demo time.

## SECURITY

**OWASP Juice Shop is intentionally, thoroughly vulnerable.** It exists only as a
controlled scan target for authorized self-assessment.

- Do **not** expose this to any untrusted network. The compose file publishes only
  to host port `8899`; keep it bound to localhost / a trusted host and never
  port-forward or reverse-proxy it to the public internet.
- Only run scans against this bundled target. AuditMesh's allowlist enforces this,
  but the responsibility for keeping the target private is yours.
- For authorized self-assessment / demo use only.
