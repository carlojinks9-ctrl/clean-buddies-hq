import { NextRequest, NextResponse } from 'next/server'
import { exchangeGoogleCode } from '@/lib/google'
import { createServerClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const storedState = request.cookies.get('google_oauth_state')?.value

  if (!code) return NextResponse.json({ error: 'No code' }, { status: 400 })
  if (!state || state !== storedState) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 403 })
  }

  try {
    const tokens = await exchangeGoogleCode(code)
    const db = createServerClient()

    await db.from('integration_tokens').upsert({
      service: 'google',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      metadata: { scope: tokens.scope },
    }, { onConflict: 'service' })

    const response = NextResponse.redirect(new URL('/settings?connected=google', request.url))
    response.cookies.delete('google_oauth_state')
    return response
  } catch (err) {
    console.error('Google OAuth error:', err)
    return NextResponse.redirect(new URL('/settings?error=google_auth_failed', request.url))
  }
}
