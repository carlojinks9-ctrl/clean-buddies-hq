import { NextRequest, NextResponse } from 'next/server'
import { exchangeJobberCode } from '@/lib/jobber'
import { createServerClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const storedState = request.cookies.get('jobber_oauth_state')?.value

  if (!code) return NextResponse.json({ error: 'No code provided' }, { status: 400 })
  if (!state || state !== storedState) {
    return NextResponse.json({ error: 'Invalid state — CSRF check failed' }, { status: 403 })
  }

  try {
    const tokens = await exchangeJobberCode(code)
    console.log('Jobber token response keys:', Object.keys(tokens), '| expires_in:', (tokens as any).expires_in)
    const db = createServerClient()

    // expires_in may be absent or non-numeric from Jobber — default to 2 hours
    const expiresIn = typeof (tokens as any).expires_in === 'number' && (tokens as any).expires_in > 0
      ? (tokens as any).expires_in
      : 7200
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

    await db.from('integration_tokens').upsert({
      service: 'jobber',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      metadata: { scope: tokens.scope },
    }, { onConflict: 'service' })

    const response = NextResponse.redirect(new URL('/settings?connected=jobber', request.url))
    response.cookies.delete('jobber_oauth_state')
    return response
  } catch (err) {
    console.error('Jobber OAuth callback error:', err)
    return NextResponse.redirect(new URL('/settings?error=jobber_auth_failed', request.url))
  }
}
