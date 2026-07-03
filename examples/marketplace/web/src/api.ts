import { useEffect, useRef, useState } from 'react'
import type { Feed } from './types'

const FEED_URL = import.meta.env.VITE_FEED_URL ?? 'http://localhost:4000'

/** The session this feed is pinned to — the app auto-binds to it so no ?session paste is needed. */
export async function fetchDefaultSession(): Promise<string> {
  try {
    const r = await fetch(`${FEED_URL}/api/session`)
    const b = (await r.json()) as { session?: string }
    return b.session ?? ''
  } catch {
    return ''
  }
}

/** Ask the feed server to launch a market session; returns its id. (Fund wallets first.) */
export async function startMarket(): Promise<string> {
  const r = await fetch(`${FEED_URL}/api/start`, { method: 'POST' })
  const body = (await r.json()) as { session?: string; error?: string }
  if (!r.ok || !body.session) throw new Error(body.error ?? `start failed (${r.status})`)
  return body.session
}

export interface FeedState {
  rounds: Feed['rounds']
  connected: boolean
  error?: string
}

export interface ScanStatus {
  running: boolean
  done?: boolean
  target?: string
  scope?: string[]
  scanMode?: string
  activity?: string
  startedAt?: number
  findings?: number
  highestSeverity?: string
  error?: string
}

/** Poll the host-side Strix scan status so the UI can show a live "agent is running a pentest" state. */
export function useScanStatus(intervalMs = 1500): ScanStatus {
  const [status, setStatus] = useState<ScanStatus>({ running: false })
  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const r = await fetch(`${FEED_URL}/api/scan-status`)
        if (!r.ok) return
        const s = (await r.json()) as ScanStatus
        if (!stop) setStatus(s)
      } catch { /* feed not up yet */ }
    }
    void tick()
    const id = setInterval(tick, intervalMs)
    return () => { stop = true; clearInterval(id) }
  }, [intervalMs])
  return status
}

/**
 * Poll the feed server for a session's rounds. A plain hook (no extra deps) — swap for TanStack Query
 * or an SSE endpoint when you outgrow polling. `intervalMs` defaults to 1s.
 */
export function useFeed(session: string, intervalMs = 1000): FeedState {
  const [state, setState] = useState<FeedState>({ rounds: [], connected: false })
  const stop = useRef(false)

  useEffect(() => {
    stop.current = false
    const tick = async () => {
      try {
        // With no explicit session, poll the feed's default (its SESSION env) so `localhost:5173`
        // follows whatever session the launcher is serving — no ?session needed.
        const q = session ? `?session=${encodeURIComponent(session)}` : ''
        const r = await fetch(`${FEED_URL}/api/feed${q}`)
        if (!r.ok) throw new Error(`feed ${r.status}`)
        const feed = (await r.json()) as Feed
        if (!stop.current) setState({ rounds: feed.rounds ?? [], connected: true })
      } catch (e) {
        if (!stop.current) setState((s) => ({ ...s, connected: false, error: (e as Error).message }))
      }
    }
    void tick()
    const id = setInterval(tick, intervalMs)
    return () => { stop.current = true; clearInterval(id) }
  }, [session, intervalMs])

  return state
}
