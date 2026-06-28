// POST /api/feedback — create a GitHub issue on the user's behalf so they can
// report a bug or suggest an idea without needing a GitHub account.
//
// The GitHub token lives ONLY in the server env (FEEDBACK_GITHUB_TOKEN), never
// reaches the browser. Use a fine-grained PAT scoped to this repo with
// "Issues: Read and write" permission.

import type { VercelRequest, VercelResponse } from '@vercel/node'

const REPO = 'EVEWildcard/EVE-PI-Helper'
const MAX_MESSAGE = 5000
// GitHub rejects issue bodies over 65536 chars; cap the snapshot well under that.
const MAX_SNAPSHOT = 50000

type Meta = Record<string, unknown>

function str(v: unknown, fallback = '—', max = 300): string {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v)
  const t = s.trim()
  return t ? t.slice(0, max) : fallback
}

// The client sends a sanitized localStorage map (key → string value). Render it
// as a collapsed, replayable block. Defensive: only keep string→string entries.
function snapshotBlock(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([k, v]) => typeof k === 'string' && typeof v === 'string') as [string, string][]
  if (entries.length === 0) return []

  let json = JSON.stringify(Object.fromEntries(entries), null, 2)
  let note = ''
  if (json.length > MAX_SNAPSHOT) {
    json = json.slice(0, MAX_SNAPSHOT)
    note = '\n…(truncated)'
  }

  return [
    '',
    '<details><summary>🛰️ Anonymized PI snapshot (click to expand)</summary>',
    '',
    'Reporter\'s setup with all account/character names removed. To reproduce locally,',
    'paste this into the browser console on the app, then reload:',
    '',
    '```js',
    'const s = /* paste the JSON below */;',
    'Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, v));',
    'location.reload();',
    '```',
    '',
    '```json',
    json + note,
    '```',
    '</details>',
  ]
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }

  const token = process.env.FEEDBACK_GITHUB_TOKEN
  if (!token) {
    res.status(503).json({ ok: false, error: 'Feedback is not configured yet.' })
    return
  }

  const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {}

  // Honeypot — bots fill hidden fields. Pretend success, create nothing.
  if (typeof body.website === 'string' && body.website.trim()) {
    res.status(200).json({ ok: true })
    return
  }

  const type = body.type === 'bug' ? 'bug' : 'idea'
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    res.status(400).json({ ok: false, error: 'Please enter a description.' })
    return
  }
  if (message.length > MAX_MESSAGE) {
    res.status(400).json({ ok: false, error: `Please keep it under ${MAX_MESSAGE} characters.` })
    return
  }

  const meta = (body.meta && typeof body.meta === 'object') ? body.meta as Meta : {}
  const firstLine = message.split('\n')[0].slice(0, 70).trim()
  const title = `[${type === 'bug' ? 'Bug' : 'Idea'}] ${firstLine || (type === 'bug' ? 'Bug report' : 'Suggestion')}`

  const issueBody = [
    message,
    '',
    '---',
    '_Submitted from the app_',
    '',
    `- **Type:** ${type}`,
    `- **Screen:** ${str(meta.screen)}`,
    `- **App version:** ${str(meta.version)}`,
    `- **Characters loaded:** ${str(meta.characters)}`,
    `- **Viewport:** ${str(meta.viewport)}`,
    `- **Locale:** ${str(meta.locale)}`,
    `- **Time:** ${str(meta.timestamp, new Date().toISOString())}`,
    `- **User agent:** ${str(meta.userAgent ?? req.headers['user-agent'])}`,
    ...snapshotBlock(body.snapshot),
  ].join('\n')

  const labels = [type === 'bug' ? 'bug' : 'enhancement']

  const createIssue = (withLabels: boolean) =>
    fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'eve-pi-helper-feedback',
      },
      body: JSON.stringify(withLabels ? { title, body: issueBody, labels } : { title, body: issueBody }),
    })

  try {
    let resp = await createIssue(true)
    // A label that doesn't exist yet makes GitHub reject the whole call (422);
    // retry without labels so the report still gets through.
    if (resp.status === 422) resp = await createIssue(false)

    if (!resp.ok) {
      console.error('[feedback] GitHub error', resp.status, await resp.text())
      res.status(502).json({ ok: false, error: 'Could not submit right now. Please try again later.' })
      return
    }

    const issue = await resp.json() as { html_url?: string }
    res.status(200).json({ ok: true, url: issue.html_url })
  } catch (e) {
    console.error('[feedback] failed', e)
    res.status(502).json({ ok: false, error: 'Could not submit right now. Please try again later.' })
  }
}
