import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { refreshGoogleToken, getGmailMessages, getGmailMessage } from '@/lib/google'

// Key GC contacts — messages from these senders get priority display
const GC_DOMAINS = [
  'chordconstruction', 'blackstonedev', 'blandfordhomes', 'valwest',
  'luxuryremodels', 'designbuildcustom',
]

function isGcContact(from: string): boolean {
  const lower = from.toLowerCase()
  return GC_DOMAINS.some(d => lower.includes(d))
}

export const dynamic = 'force-dynamic'

export async function GET() {
  const db = createServerClient()

  const { data: tokenRow } = await db
    .from('integration_tokens')
    .select('*')
    .eq('service', 'google')
    .single()

  if (!tokenRow) {
    return NextResponse.json({ error: 'Google not connected', messages: [] }, { status: 200 })
  }

  let accessToken = tokenRow.access_token

  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() - 60_000 < Date.now()) {
    try {
      const refreshed = await refreshGoogleToken(tokenRow.refresh_token!)
      accessToken = refreshed.access_token
      await db.from('integration_tokens').update({
        access_token: refreshed.access_token,
        ...(refreshed.refresh_token ? { refresh_token: refreshed.refresh_token } : {}),
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      }).eq('service', 'google')
    } catch {
      return NextResponse.json({ error: 'Token refresh failed', messages: [] }, { status: 200 })
    }
  }

  try {
    // Fetch unread messages — limit to 8
    const listData = await getGmailMessages(accessToken, 'is:unread -category:promotions -category:social', 8)
    const messageIds: string[] = (listData.messages || []).map((m: { id: string }) => m.id)

    const messages = await Promise.all(
      messageIds.slice(0, 8).map(async (id) => {
        try {
          const msg = await getGmailMessage(accessToken, id)
          const headers: Array<{ name: string; value: string }> = msg.payload?.headers || []
          const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''
          const from = getHeader('From')
          const subject = getHeader('Subject')
          const date = getHeader('Date')
          return {
            id,
            from,
            subject,
            date,
            isGc: isGcContact(from),
            snippet: msg.snippet || '',
          }
        } catch {
          return null
        }
      })
    )

    const filtered = messages.filter(Boolean)
    // Sort: GC contacts first, then by date
    filtered.sort((a, b) => {
      if (a!.isGc && !b!.isGc) return -1
      if (!a!.isGc && b!.isGc) return 1
      return 0
    })

    return NextResponse.json({
      ok: true,
      messages: filtered,
      total_unread: listData.resultSizeEstimate || filtered.length,
      fetched_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[sync/gmail] error:', err)
    return NextResponse.json({ error: String(err), messages: [] }, { status: 200 })
  }
}
