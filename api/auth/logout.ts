// POST /api/auth/logout — remove one character's token (?characterId=123) or
// clear the whole session if no id is given. Clears server-side tokens only;
// the browser's localStorage character data is removed by the client.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSession } from '../_lib/session.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const session = await getSession(req, res)
  const id = typeof req.query.characterId === 'string' ? req.query.characterId : ''

  if (id && session.tokens) {
    delete session.tokens[id]
    await session.save()
  } else {
    session.destroy()
  }
  res.status(200).json({ ok: true })
}
