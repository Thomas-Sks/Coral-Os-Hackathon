// Typed client for the bridge endpoints. The browser only ever talks to the bridge —
// never directly to CoralOS or Solana RPC (except the wallet-adapter's read connection).

const json = (r: Response) =>
  r.ok ? r.json() : r.json().then((e: { error?: string }) => Promise.reject(new Error(e.error || r.statusText)))

export interface Order {
  reference: string
  amountSol: string
  solanaPayUrl: string
  recipient: string
}
export interface Delivered {
  status: string
  sig: string
  data: string
}
export interface FeedMsg {
  sender: string // buyer-agent | seller-agent | broker | seller-cheap | seller-premium
  text: string
}

const POST = (url: string, body?: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(json)

export const startOrder = (service: string, prompt?: string): Promise<Order> =>
  POST('/order', { service, prompt })

export const submitPaid = (reference: string, sig: string): Promise<Delivered> =>
  POST(`/order/${reference}/paid`, { sig })

export const startAutonomous = (): Promise<{ sessionId: string }> => POST('/autonomous/start')

export const getFeed = (): Promise<{ running: boolean; messages: FeedMsg[] }> =>
  fetch('/autonomous/feed').then(json)

export const startSwarm = (): Promise<{ sessionId: string }> => POST('/swarm/start')

export const getSwarmFeed = (): Promise<{ running: boolean; messages: FeedMsg[] }> =>
  fetch('/swarm/feed').then(json)
