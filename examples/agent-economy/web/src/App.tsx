import { useEffect, useState } from 'react'
import { AutonomousTab } from './components/AutonomousTab'
import { CheckoutTab } from './components/CheckoutTab'
import { SwarmTab } from './components/SwarmTab'

type Theme = 'dark' | 'light'

export default function App() {
  const [tab, setTab] = useState<'auto' | 'checkout' | 'swarm'>('auto')
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('theme') as Theme) || 'dark',
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  return (
    <div className="app">
      <header>
        <div className="bar">
          <h1>sol_coralOS</h1>
          <button
            className="theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle color theme"
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
        <p className="sub">An agent economy on Solana — one seller, two front doors.</p>
      </header>

      <nav className="tabs">
        <button className={tab === 'auto' ? 'on' : ''} onClick={() => setTab('auto')}>
          Autonomous
        </button>
        <button className={tab === 'checkout' ? 'on' : ''} onClick={() => setTab('checkout')}>
          Checkout
        </button>
        <button className={tab === 'swarm' ? 'on' : ''} onClick={() => setTab('swarm')}>
          Swarm
        </button>
      </nav>

      {tab === 'auto' && <AutonomousTab />}
      {tab === 'checkout' && <CheckoutTab />}
      {tab === 'swarm' && <SwarmTab />}
    </div>
  )
}
