import { NextRequest, NextResponse } from 'next/server'
import { exchangeQboCode } from '@/lib/qbo'
import { createServerClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const realmId = url.searchParams.get('realmId') || ''
  const state = url.searchParams.get('state')
  const storedState = request.cookies.get('qbo_oauth_state')?.value

  if (!code || !realmId) return NextResponse.json({ error: 'Missing code or realmId' }, { status: 400 })
  if (!state || state !== storedState) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 403 })
  }

  try {
    const tokens = await exchangeQboCode(code, realmId)
    const db = createServerClient()

    await db.from('integration_tokens').upsert({
      service: 'qbo',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      metadata: { realm_id: realmId, x_refresh_token_expires_in: tokens.x_refresh_token_expires_in },
    }, { onConflict: 'service' })

    const response = NextResponse.redirect(new URL('/settings?connected=qbo', request.url))
    response.cookies.delete('qbo_oauth_state')
    return response
  } catch (err) {
    console.error('QBO OAuth error:', err)
    return NextResponse.redirect(new URL('/settings?error=qbo_auth_failed', request.url))
  }
}
