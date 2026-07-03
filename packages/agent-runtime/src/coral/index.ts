// CoralOS pillar — MCP client + the standalone agent entrypoint.

export { CoralMcpAgent } from './mcp.js'
export type { CoralMention, CoralMcpConfig } from './mcp.js'

export { startCoralAgent } from './server.js'
export type { CoralAgentConfig, CoralAgentContext } from './server.js'
