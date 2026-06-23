import React from 'react'
import styles from './ErrorBoundary.module.css'

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    const { error } = this.state
    return (
      <>
        {error ? (
          <div className={styles.crashed}>
            <span className={styles.icon}>⚠</span>
            <span className={styles.msg}>This section crashed — <strong>{error.message}</strong></span>
            <button className={styles.reset} onClick={() => this.setState({ error: null })}>dismiss</button>
          </div>
        ) : (
          this.props.children
        )}
      </>
    )
  }
}
