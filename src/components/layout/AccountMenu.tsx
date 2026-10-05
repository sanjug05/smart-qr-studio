import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import './AccountMenu.css'

function Avatar({ name, photoURL }: { name: string; photoURL: string | null }) {
  if (photoURL) {
    // Google profile photos are served from googleusercontent.com; a failed load falls back to the initial below.
    return <img className="account-avatar" src={photoURL} alt="" referrerPolicy="no-referrer" width={32} height={32} />
  }
  return (
    <span className="account-avatar account-avatar-initial" aria-hidden="true">
      {(name || '?').charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * Sign in / account control, shown at the top of every studio screen.
 * Signed out: a Google sign-in button and one line saying why. Signed in:
 * avatar + name, a link to My QR Codes, and Sign out. Renders nothing when
 * this build has no Firebase configuration (the app is then purely local).
 */
export default function AccountMenu() {
  const { status, user, error, signingIn, signIn, signOut, clearError } = useAuth()

  if (status === 'unavailable') return null
  if (status === 'loading') return <div className="account-bar" aria-busy="true" />

  if (status === 'signedIn' && user) {
    const name = user.displayName || user.email || 'Account'
    return (
      <div className="account-bar">
        <div className="account-signed-in">
          <Avatar name={name} photoURL={user.photoURL} />
          <div className="account-who">
            <span className="account-name">{name}</span>
            {user.displayName && user.email ? <span className="account-email">{user.email}</span> : null}
          </div>
          <Link to="/codes" className="btn btn-ghost account-link">
            My QR Codes
          </Link>
          <button className="btn btn-ghost account-link" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="account-bar">
      <div className="account-signed-out">
        <span className="account-hint">Sign in to save your QR codes and access them across devices.</span>
        <button className="btn btn-secondary account-google" onClick={() => void signIn()} disabled={signingIn}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" />
            <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
            <path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.7l-7.6-5.9c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
          </svg>
          {signingIn ? 'Signing in…' : 'Continue with Google'}
        </button>
      </div>
      {error ? (
        <p className="error account-error" role="alert">
          {error}{' '}
          <button className="btn btn-ghost account-dismiss" onClick={clearError}>
            Dismiss
          </button>
        </p>
      ) : null}
    </div>
  )
}
