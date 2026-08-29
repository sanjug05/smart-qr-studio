import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last-resort catch for render-time exceptions React itself doesn't
 * recover from — a stale JS chunk after a redeploy, a data shape that
 * slipped past validation, a third-party rendering error. Without this,
 * any such error unmounts the whole app to a blank white screen; with it,
 * the user sees an explanation and a way back instead of nothing.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Smart QR Studio: unhandled render error', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const isStaleChunk = /dynamically imported module|Failed to fetch/i.test(error.message)

    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Something went wrong</h1>
        <p style={{ color: 'var(--color-ink-muted)', maxWidth: 420, margin: 0 }}>
          {isStaleChunk
            ? "This page was updated since you loaded it. Reloading will fetch the latest version."
            : "Smart QR Studio hit an unexpected error. Your saved projects are untouched — reloading usually resolves this."}
        </p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
