// Shared iron-session config. Tokens live encrypted inside an httpOnly cookie —
// JavaScript on the page can never read them, which kills the XSS → token-theft
// risk. Stateless: no database.

import { getIronSession, type SessionOptions } from 'iron-session'
import type { IncomingMessage, ServerResponse } from 'http'

export interface SessionData {
  // characterId → EVE refresh token
  tokens?: Record<string, string>
  // transient PKCE state, only present between /login and /callback
  pkce?: { verifier: string; state: string }
}

const password = process.env.SESSION_SECRET
if (!password || password.length < 32) {
  // Fail loud at cold start rather than silently issuing weak cookies.
  throw new Error('SESSION_SECRET env var must be set to a 32+ character string')
}

export const sessionOptions: SessionOptions = {
  password,
  cookieName: 'evepi_session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90, // 90 days
  },
}

export function getSession(req: IncomingMessage, res: ServerResponse) {
  return getIronSession<SessionData>(req, res, sessionOptions)
}
