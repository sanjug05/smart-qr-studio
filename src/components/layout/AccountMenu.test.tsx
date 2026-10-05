import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'

const auth = {
  status: 'signedOut' as 'loading' | 'unavailable' | 'signedOut' | 'signedIn',
  user: null as null | { uid: string; displayName: string | null; email: string | null; photoURL: string | null },
  error: null as string | null,
  signingIn: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  clearError: vi.fn()
}
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }))

const { default: AccountMenu } = await import('./AccountMenu')
const render = () =>
  renderToStaticMarkup(
    <StaticRouter location="/">
      <AccountMenu />
    </StaticRouter>
  )

describe('AccountMenu', () => {
  beforeEach(() => {
    Object.assign(auth, { status: 'signedOut', user: null, error: null, signingIn: false })
  })

  it('signed out: explains why to sign in and offers Continue with Google', () => {
    const html = render()
    expect(html).toContain('Sign in to save your QR codes and access them across devices.')
    expect(html).toContain('Continue with Google')
    expect(html).not.toContain('Sign out')
  })

  it('signed out while signing in: the button is disabled and says so', () => {
    auth.signingIn = true
    const html = render()
    expect(html).toContain('Signing in…')
    expect(html).toMatch(/<button[^>]*disabled/)
  })

  it('signed in: shows name, email, My QR Codes and Sign out — and no sign-in button', () => {
    Object.assign(auth, { status: 'signedIn', user: { uid: 'u1', displayName: 'Ada Lovelace', email: 'ada@example.com', photoURL: null } })
    const html = render()
    expect(html).toContain('Ada Lovelace')
    expect(html).toContain('ada@example.com')
    expect(html).toContain('My QR Codes')
    expect(html).toContain('Sign out')
    expect(html).not.toContain('Continue with Google')
  })

  it('signed in: uses the Google profile photo when there is one, and an initial otherwise', () => {
    Object.assign(auth, { status: 'signedIn', user: { uid: 'u1', displayName: 'Ada', email: null, photoURL: 'https://lh3.googleusercontent.com/a/photo' } })
    expect(render()).toContain('src="https://lh3.googleusercontent.com/a/photo"')
    auth.user = { uid: 'u1', displayName: 'Ada', email: null, photoURL: null }
    const html = render()
    expect(html).not.toContain('<img')
    expect(html).toContain('>A<')
  })

  it('falls back to the email when there is no display name', () => {
    Object.assign(auth, { status: 'signedIn', user: { uid: 'u1', displayName: null, email: 'ada@example.com', photoURL: null } })
    expect(render()).toContain('ada@example.com')
  })

  it('shows a sign-in error as an alert', () => {
    auth.error = 'Your browser blocked the sign-in window.'
    const html = render()
    expect(html).toContain('role="alert"')
    expect(html).toContain('Your browser blocked the sign-in window.')
  })

  it('renders nothing visible when cloud features are not configured, and a quiet placeholder while loading', () => {
    auth.status = 'unavailable'
    expect(render()).toBe('')
    auth.status = 'loading'
    expect(render()).not.toContain('Continue with Google')
  })

  it('never renders an access token or credential', () => {
    Object.assign(auth, { status: 'signedIn', user: { uid: 'u1', displayName: 'Ada', email: 'ada@example.com', photoURL: null } })
    expect(render()).not.toMatch(/token|idToken|accessToken/i)
  })
})
