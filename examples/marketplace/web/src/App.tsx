import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useFeed, useScanStatus, startMarket, fetchDefaultSession } from './api'
import { shortId } from './format'
import { MarketView } from './components/MarketView'
import { Explainer } from './components/Explainer'
import { StatsStrip } from './components/StatsStrip'
import { RoundsRail } from './components/RoundsRail'
import { Negotiation } from './components/Negotiation'
import { RoundDetail } from './components/RoundDetail'
import { ScanStatusHero } from './components/ScanStatus'
import { PersonaLegend } from './components/PersonaLegend'
import { SessionExplorer } from './components/SessionExplorer'

/** Read ?session=<id> from the URL so the launcher can deep-link straight to a live market. */
const initialSession = new URLSearchParams(window.location.search).get('session') ?? ''

export default function App() {
  const [session, setSession] = useState(initialSession)
  const [starting, setStarting] = useState(false)
  const [startErr, setStartErr] = useState<string>()
  const [showHistory, setShowHistory] = useState(true)
  // The round the user pinned by clicking the rail. Null → follow the newest round live.
  const [pinned, setPinned] = useState<number | null>(null)
  const { rounds, connected, error } = useFeed(session)
  const scan = useScanStatus()

  // Auto-bind to the feed's current session so opening the dashboard shows the live market with
  // nothing to paste — reflect it in the URL + the session field too.
  useEffect(() => {
    if (session) return
    let stop = false
    const bind = async () => {
      const s = await fetchDefaultSession()
      if (s && !stop) {
        setSession(s)
        const url = new URL(window.location.href)
        url.searchParams.set('session', s)
        window.history.replaceState({}, '', url)
      }
    }
    void bind()
    const id = setInterval(bind, 3000)
    return () => { stop = true; clearInterval(id) }
  }, [session])

  const newest = rounds.length ? Math.max(...rounds.map((r) => r.round)) : undefined
  const pinnedExists = pinned != null && rounds.some((r) => r.round === pinned)
  const focusedNum = pinnedExists ? pinned! : newest
  const following = !pinnedExists || focusedNum === newest
  const focused = useMemo(
    () => rounds.find((r) => r.round === focusedNum),
    [rounds, focusedNum],
  )

  async function onStart() {
    setStarting(true)
    setStartErr(undefined)
    try {
      const id = await startMarket()
      setSession(id)
      setPinned(null)
      const url = new URL(window.location.href)
      url.searchParams.set('session', id)
      window.history.replaceState({}, '', url)
    } catch (e) {
      setStartErr((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="app">
      <div className="bg-decor" aria-hidden />

      <header className="hero">
        <div className="hero-top">
          <div className="brand">
            <span className="brand-mark" aria-hidden>◆</span>
            <span className="brand-name">AuditMesh</span>
            <span className={`live ${connected ? 'live-on' : 'live-off'}`}>
              <span className="live-dot" />
              {connected ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>
          <div className="hero-right">
            {session && <span className="session-chip mono" title={session}>{shortId(session, 8, 6)}</span>}
            <span
              className={`dot ${connected ? 'dot-on' : 'dot-off'}`}
              data-testid="conn"
              title={connected ? 'connected' : error ?? 'disconnected'}
            />
          </div>
        </div>
        <h1 className="hero-title">The autonomous audit marketplace</h1>
        <p className="hero-tag">
          Autonomous agents negotiate, verify consent on-chain, and settle security audits on Solana.
        </p>

        <div className="session-bar">
          <input
            aria-label="session id"
            placeholder="paste a market session id…"
            value={session}
            onChange={(e) => setSession(e.target.value.trim())}
          />
          <button onClick={onStart} disabled={starting} data-testid="start">
            {starting ? 'starting…' : 'Start a market'}
          </button>
        </div>
        {startErr && <p className="start-err" data-testid="start-err">{startErr}</p>}

        <SessionExplorer rounds={rounds} />
      </header>

      <main className="stage-wrap">
        <details className="agents-panel" open>
          <summary>The agents — who's competing &amp; what they deliver</summary>
          <PersonaLegend />
        </details>

        <AnimatePresence>
          {(scan.running || (scan.done && rounds.length === 0)) && <ScanStatusHero scan={scan} />}
        </AnimatePresence>

        {rounds.length > 0 && <StatsStrip rounds={rounds} />}

        {rounds.length > 0 ? (
          <>
            <div className="floor">
              <RoundsRail
                rounds={rounds}
                focused={focusedNum}
                following={following}
                onPick={(n) => setPinned(n === newest ? null : n)}
              />

              <section className="stage">
                {!following && (
                  <button className="follow-live" onClick={() => setPinned(null)}>
                    ● Jump to live round
                  </button>
                )}
                <AnimatePresence mode="wait">
                  {focused && (
                    <motion.div
                      key={focused.round}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.22, ease: 'easeOut' }}
                    >
                      <Negotiation round={focused} />
                      <RoundDetail round={focused} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            </div>

            <details className="how" open={false}>
              <summary>How the market works</summary>
              <Explainer />
            </details>

            <section className="history">
              <button className="history-toggle" onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? '▾' : '▸'} Full round history
                <span className="history-count mono">{rounds.length}</span>
              </button>
              {showHistory && <MarketView rounds={rounds} />}
            </section>
          </>
        ) : scan.running || (scan.done && rounds.length === 0) ? null : (
          <p className="empty" data-testid="empty">
            {session
              ? 'Waiting for the buyer to broadcast a WANT…'
              : 'Fund your wallets, then Start a market — audit agents will bid, prove consent, and settle live.'}
          </p>
        )}
      </main>
    </div>
  )
}
