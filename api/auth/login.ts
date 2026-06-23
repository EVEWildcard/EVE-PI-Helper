// GET /api/auth/login — begin EVE SSO. Generate PKCE, stash verifier+state in
// the session cookie, then redirect the browser to CCP's authorize page.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSession } from '../_lib/session.js'
import { AUTH_URL, SCOPES, clientId, makePkce, callbackUrl } from '../_lib/oauth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const session = await getSession(req, res)
  const { verifier, challenge, state } = makePkce()
  session.pkce = { verifier, state }
  await session.save()

  const host = req.headers.host ?? ''
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: callbackUrl(host),
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  res.redirect(302, `${AUTH_URL}?${params}`)
}
