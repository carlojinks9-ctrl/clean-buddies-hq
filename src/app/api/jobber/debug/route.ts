import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { refreshJobberToken } from '@/lib/jobber'

export const dynamic = 'force-dynamic'

const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql'

export async function GET() {
  const db = createServerClient()
  const { data: tokenRow, error } = await db
    .from('integration_tokens').select('*').eq('service', 'jobber').single()

  if (!tokenRow) return NextResponse.json({ error: 'No token stored', detail: error }, { status: 400 })

  let token = tokenRow.access_token
  const expired = tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() - 60_000 < Date.now()

  if (expired) {
    try {
      const refreshed = await refreshJobberToken(tokenRow.refresh_token!)
      token = refreshed.access_token
      await db.from('integration_tokens').update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: new Date(Date.now() + ((refreshed as any).expires_in ?? 7200) * 1000).toISOString(),
      }).eq('service', 'jobber')
    } catch (refreshErr) {
      return NextResponse.json({ error: 'Token refresh failed', detail: String(refreshErr) }, { status: 500 })
    }
  }

  // Raw test against the correct Jobber GraphQL endpoint
  const res = await fetch(JOBBER_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-JOBBER-GRAPHQL-VERSION': '2024-01-15',
      'User-Agent': 'CleanBuddiesHQ/1.0',
    },
    body: JSON.stringify({ query: '{ __typename }' }),
  })

  const contentType = res.headers.get('content-type') || ''
  const rawBody = await res.text()

  // Detect HTML — means wrong endpoint or redirect to login page
  if (contentType.includes('text/html') || rawBody.trimStart().startsWith('<')) {
    return NextResponse.json({
      error: 'Jobber returned HTML instead of JSON — wrong endpoint or auth redirect',
      endpoint_used: JOBBER_GRAPHQL_URL,
      http_status: res.status,
      content_type: contentType,
      html_preview: rawBody.slice(0, 200),
    }, { status: 502 })
  }

  let parsed: unknown = null
  try { parsed = JSON.parse(rawBody) } catch { /* leave null */ }

  return NextResponse.json({
    endpoint_used: JOBBER_GRAPHQL_URL,
    token_preview: token.slice(0, 30) + '…',
    token_length: token.length,
    expires_at: tokenRow.expires_at,
    was_expired: expired,
    scope: tokenRow.metadata?.scope,
    raw_test: {
      status: res.status,
      content_type: contentType,
      body_preview: rawBody.slice(0, 400),
      parsed_ok: parsed !== null,
      graphql_data: (parsed as any)?.data ?? null,
      graphql_errors: (parsed as any)?.errors ?? null,
    },
  })
}
