import React, { useMemo, useState } from 'react'
import { APP_VERSION } from '../../version'
import { buildSnapshot } from './snapshot'
import styles from './FeedbackModal.module.css'

type FeedbackType = 'bug' | 'idea'
type Status = 'idle' | 'sending' | 'done' | 'error'

interface Props {
  screen: string
  characterCount: number
  onClose: () => void
  /** Pre-fill the form (e.g. the "too many accounts" prompt opens it ready to send). */
  initialMessage?: string
  initialType?: FeedbackType
}

function buildMeta(screen: string, characterCount: number) {
  return {
    screen,
    version: APP_VERSION,
    characters: characterCount,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    locale: navigator.language,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
  }
}

export function FeedbackModal({ screen, characterCount, onClose, initialMessage, initialType }: Props) {
  const [type, setType] = useState<FeedbackType>(initialType ?? 'bug')
  const [message, setMessage] = useState(initialMessage ?? '')
  const [website, setWebsite] = useState('') // honeypot
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [issueUrl, setIssueUrl] = useState<string | null>(null)

  const meta = buildMeta(screen, characterCount)
  // Privacy-safe snapshot of the current PI setup so we can reproduce the report
  // locally. No account or character names — see snapshot.ts. Built once on open.
  const snapshot = useMemo(() => buildSnapshot(), [])

  async function submit() {
    if (!message.trim() || status === 'sending') return
    setStatus('sending')
    setError(null)
    try {
      const resp = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, message: message.trim(), website, meta, snapshot: snapshot?.data }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || !data.ok) {
        setError(data.error || 'Could not submit right now. Please try again later.')
        setStatus('error')
        return
      }
      setIssueUrl(typeof data.url === 'string' ? data.url : null)
      setStatus('done')
    } catch {
      setError('Network error — please try again.')
      setStatus('error')
    }
  }

  function copyReport() {
    const metaText = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n')
    const snapText = snapshot ? `\n\nPI snapshot (anonymized):\n${JSON.stringify(snapshot.data)}` : ''
    navigator.clipboard?.writeText(`[${type}] ${message.trim()}\n\n${metaText}${snapText}`).catch(() => {})
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {status === 'done' ? (
          <>
            <h2 className={styles.title}>Thank you! 🛰️</h2>
            <p className={styles.text}>
              Your {type === 'bug' ? 'bug report' : 'idea'} was sent — we really appreciate it.
            </p>
            <div className={styles.actions}>
              {issueUrl && (
                <a className={styles.linkBtn} href={issueUrl} target="_blank" rel="noreferrer">
                  View on GitHub ↗
                </a>
              )}
              <button className={styles.confirm} onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.title}>Send feedback</h2>
            <p className={styles.text}>
              Found a bug or have an idea? Tell us — it genuinely helps. We'll include which
              screen you're on, a bit of technical info, and an anonymized copy of your PI setup
              (planets &amp; skills — <strong>never</strong> your account or character names) so we
              can reproduce it.
            </p>

            <div className={styles.typeToggle}>
              <button
                className={`${styles.typeBtn} ${type === 'bug' ? styles.typeActive : ''}`}
                onClick={() => setType('bug')}
              >
                🐞 Bug
              </button>
              <button
                className={`${styles.typeBtn} ${type === 'idea' ? styles.typeActive : ''}`}
                onClick={() => setType('idea')}
              >
                💡 Idea
              </button>
            </div>

            <textarea
              className={styles.textarea}
              placeholder={type === 'bug'
                ? 'What happened? What did you expect instead?'
                : 'What would make the tool better?'}
              value={message}
              onChange={e => setMessage(e.target.value)}
              maxLength={5000}
              autoFocus
            />

            {/* honeypot — hidden from humans, catches bots */}
            <input
              className={styles.honeypot}
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={e => setWebsite(e.target.value)}
              aria-hidden="true"
            />

            <p className={styles.metaNote}>
              Sending from <strong>{screen}</strong> · v{APP_VERSION} · {characterCount} character{characterCount !== 1 ? 's' : ''}
              {snapshot && ` · ${snapshot.summary.planets} planet${snapshot.summary.planets !== 1 ? 's' : ''} (anonymized)`}
            </p>

            {status === 'error' && (
              <div className={styles.error}>
                {error}
                <button className={styles.copyBtn} onClick={copyReport}>Copy report instead</button>
              </div>
            )}

            <div className={styles.actions}>
              <button className={styles.cancel} onClick={onClose}>Cancel</button>
              <button
                className={styles.confirm}
                onClick={submit}
                disabled={!message.trim() || status === 'sending'}
              >
                {status === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
