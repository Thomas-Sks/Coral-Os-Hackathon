# user_proxy

The **human's stand-in** in a CoralOS session — the one piece of Python in the kit (~40 lines).

A human isn't an MCP agent, so they can't join a coral session directly. `user_proxy` is a named
participant that connects over MCP and then **idles**. The **bridge**
(`examples/agent-economy/bridge`) drives it via coral-server's **Puppet API** — injecting the human's
order (`request …`, `paid …`) into a thread *as* `user-proxy`, routed to the same `seller-agent` the
autonomous buyer uses. That's how the human-checkout front door works under the hood.

```python
# agent.py — connect, list tools, then block forever; the Puppet API speaks on our behalf
async with streamablehttp_client(url) as (read, write, _):
    async with ClientSession(read, write) as session:
        await session.initialize()
        await asyncio.Event().wait()   # idle — the bridge injects messages as this agent
```

## Where it fits

- Used **only** by the human-checkout path. The autonomous (agent→agent) path doesn't need it.
- A participant **never writes or edits this** — they `docker build` it once and it just works.

## Why Python?

It mirrors CoralOS's own puppet-agent convention and the MCP Python client made the idle stand-in
trivial. It's not load-bearing for what you build — it could be ported to a TypeScript
`CoralMcpAgent` if you want a 100% TS repo.

## Build

```sh
docker build -t user-proxy:0.1.0 coral-agents/user_proxy
```

`CORAL_CONNECTION_URL` is injected by coral-server at launch. Registered via `config/coral.toml`.
