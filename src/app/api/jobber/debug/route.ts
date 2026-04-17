import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { refreshJobberToken } from '@/lib/jobber'

export async function GET() {
  const db = createServerClient()
  const { data: tokenRow, error } = await db
    .from('integration_tokens').select('*').eq('service', 'jobber').single()

  if (!tokenRow) return NextResponse.json({ error: 'No token stored', detail: error }, { status: 400 })

  let token = tokenRow.access_token
  const expired = tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() - 60_000 < Date.now()

  if (expired) {
    const refreshed = await refreshJobberToken(tokenRow.refresh_token!)
    token = refreshed.access_token
    await db.from('integration_tokens').update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: new Date(Date.now() + ((refreshed as any).expires_in ?? 7200) * 1000).toISOString(),
    }).eq('service', 'jobber')
  }

  // Return token info + a raw test against Jobber
  const rawTest = await fetch('https://api.getjobber.com/graphql', {
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

  const rawStatus = rawTest.status
  const rawBody = await rawTest.text()

  return NextResponse.json({
    token_preview: token.slice(0, 30) + '…',
    token_length: token.length,
    expires_at: tokenRow.expires_at,
    was_expired: expired,
    scope: tokenRow.metadata?.scope,
    raw_test: { status: rawStatus, body_preview: rawBody.slice(0, 300) },
  })
}
