// GET /api/esi/refresh — for every character whose refresh token is in the
// session, refresh the access token, re-import from ESI, and return the fresh
// ImportedCharacter[]. Rotated refresh tokens are saved back to the cookie.
// The browser merges the result into localStorage.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSession } from '../_lib/session.js'
import { refreshToken } from '../_lib/oauth.js'
import { importCharacterFromESI, type ImportedCharacter } from '../_lib/esiImport.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const session = await getSession(req, res)
  const tokens = session.tokens ?? {}
  const characterIds = Object.keys(tokens).map(Number).filter(Boolean)

  if (characterIds.length === 0) {
    res.status(200).json([])
    return
  }

  const imported: ImportedCharacter[] = []
  let tokensChanged = false

  const results = await Promise.allSettled(characterIds.map(async (characterId) => {
    const stored = tokens[String(characterId)]
    const refreshed = await refreshToken(stored)
    if (refreshed.refreshToken !== stored) {
      tokens[String(characterId)] = refreshed.refreshToken
      tokensChanged = true
    }
    return importCharacterFromESI(refreshed.accessToken, characterId, refreshed.characterName)
  }))

  for (const r of results) {
    if (r.status === 'fulfilled') imported.push(r.value)
    else console.error('[refresh] character failed:', r.reason)
  }

  if (tokensChanged) {
    session.tokens = tokens
    await session.save()
  }

  res.status(200).json(imported)
}
