// GET /api/auth/callback — CCP redirects here with ?code&state. Verify state,
// exchange the code for tokens (PKCE), store the refresh token in the session
// keyed by characterId, then bounce back to the app which will refresh.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSession } from '../_lib/session.js'
import { exchangeCode, callbackUrl } from '../_lib/oauth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const session = await getSession(req, res)
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  const state = typeof req.query.state === 'string' ? req.query.state : ''
  const pkce = session.pkce

  if (!code || !pkce || state !== pkce.state) {
    res.redirect(302, '/?login=error')
    return
  }

  try {
    const host = req.headers.host ?? ''
    const result = await exchangeCode(code, pkce.verifier, callbackUrl(host))
    const tokens = session.tokens ?? {}
    tokens[String(result.characterId)] = result.refreshToken
    session.tokens = tokens
    delete session.pkce
    await session.save()
    res.redirect(302, '/?login=ok')
  } catch (err) {
    console.error('[callback] token exchange failed:', err)
    delete session.pkce
    await session.save()
    res.redirect(302, '/?login=error')
  }
}
