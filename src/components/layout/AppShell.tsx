import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import PwaUpdateBanner from './PwaUpdateBanner'
import AccountMenu from './AccountMenu'
import './AppShell.css'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '⌂', end: true },
  { to: '/create', label: 'Create QR', icon: '+' },
  { to: '/codes', label: 'My QR Codes', icon: '▦' },
  { to: '/settings', label: 'Settings', icon: '⚙' }
]

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="shell-sidebar" aria-label="Primary navigation">
        <div className="shell-logo">
          <span className="shell-logo-mark">◈</span>
          <span>Smart QR Studio</span>
        </div>
        <nav>
          <ul className="shell-nav-list">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={({ isActive }) => `shell-nav-link${isActive ? ' active' : ''}`}>
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main id="main-content" className="shell-main">
        <PwaUpdateBanner />
        <AccountMenu />
        {children}
      </main>

      <nav className="shell-tabbar" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `shell-tab${isActive ? ' active' : ''}`}>
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
