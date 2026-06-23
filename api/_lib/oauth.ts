// EVE SSO PKCE helpers (server-side). The client is a public/native client —
// no secret — so token exchange and refresh happen with PKCE only.

import { createHash, randomBytes } from 'crypto'

export const AUTH_URL = 'https://login.eveonline.com/v2/oauth/authorize'
export const TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token'
export const SCOPES = [
  'esi-planets.manage_planets.v1',
  'esi-planets.read_customs_offices.v1',
  'esi-skills.read_skills.v1',
  'esi-skills.read_skillqueue.v1',
].join(' ')

export function clientId(): string {
  const id = process.env.EVE_CLIENT_ID
  if (!id) throw new Error('EVE_CLIENT_ID env var is not set')
  return id
}

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function makePkce() {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = randomBytes(16).toString('hex')
  return { verifier, challenge, state }
}

export interface TokenResult {
  accessToken: string
  refreshToken: string
  characterId: number
  characterName: string
}

function parseToken(access_token: string, refresh_token: string): TokenResult {
  const payload = JSON.parse(Buffer.from(access_token.split('.')[1], 'base64url').toString())
  const characterId = parseInt(String(payload.sub).split(':').pop()!, 10)
  return { accessToken: access_token, refreshToken: refresh_token, characterId, characterName: payload.name }
}

export async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<TokenResult> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId(),
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  })
  if (!resp.ok) throw new Error(`Token exchange failed (${resp.status}): ${await resp.text()}`)
  const { access_token, refresh_token } = await resp.json() as { access_token: string; refresh_token: string }
  return parseToken(access_token, refresh_token)
}

export async function refreshToken(token: string): Promise<TokenResult> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token,
      client_id: clientId(),
    }),
  })
  if (!resp.ok) throw new Error(`Token refresh failed (${resp.status}): ${await resp.text()}`)
  const { access_token, refresh_token } = await resp.json() as { access_token: string; refresh_token: string }
  return parseToken(access_token, refresh_token)
}

// Build the redirect URI from the incoming request host so it works on both
// localhost (vercel dev) and the production domain without hardcoding.
export function callbackUrl(host: string): string {
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https'
  return `${proto}://${host}/api/auth/callback`
}
