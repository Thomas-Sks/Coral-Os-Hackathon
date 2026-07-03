# Contributing

Contributions are welcome. The `main` branch is the integration branch — target all PRs at `main`.

## Repo Layout

| Directory | Language | Typical changes |
|-----------|----------|-----------------|
| `packages/agent-runtime/` | TypeScript | The runtime: LLM shim, Solana Pay + devnet guard, CoralOS MCP client, the market protocol |
| `examples/txodds/` | TypeScript | The World Cup Oracle — the edge transform, the proxy, the web app |
| `examples/txodds/escrow/` | Rust (Anchor) | The escrow settlement contract |

## Prerequisites

- Node.js 20+
- An LLM key + a funded devnet wallet to run the live demo (see the root README). **No Docker needed.**

## Development Commands

```sh
# build the runtime first — examples/txodds depends on its dist via a file: dep
cd packages/agent-runtime && npm install && npm run build && npm run typecheck && npm test

# typecheck + test the example
cd examples/txodds && npm install && npm run typecheck && npm test
```

## PR Workflow

1. Open an issue or comment on an existing one to discuss your change.
2. Fork the repo and create a feature branch from `main`.
3. Make your change. Add tests for new behavior.
4. Run lint and typecheck locally before pushing.
5. Use [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.).
6. Open a PR against `main`.

## Code Style

- **TypeScript:** run `npm run typecheck && npm test` in `packages/agent-runtime/` (and the package you changed) before committing.
- **Documentation:** READMEs should explain *why* a module exists, not just *what* it does.

## Security

See [SECURITY.md](./SECURITY.md) for the security policy and vulnerability reporting process.
