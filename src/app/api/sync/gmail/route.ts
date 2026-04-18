import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { refreshGoogleToken, getGmailMessages, getGmailMessage } from '@/lib/google'

// Key GC contacts — emails from these domains get surfaced in inbox
const GC_DOMAINS = [
  'chordconstruction', 'blackstonedev', 'blandfordhomes', 'valwest',
  'luxuryremodels', 'designbuildcustom',
]

// Keywords in subject/snippet that indicate a hot lead email
const HOT_KEYWORDS = [
  'quote', 'estimate', 'bid', 'proposal', 'clean', 'cleaning', 'inquiry',
  'interested', 'project', 'construction', 'post-construction', 'pricing', 'price',
]

function isGcContact(from: string): boolean {
  const lower = from.toLowerCase()
  return GC_DOMAINS.some(d => lower.includes(d))
}

function isHotEmail(subject: string, snippet: string, from: string): boolean {
  if (isGcContact(from)) return true
  const text = [subject, snippet].join(' ').toLowerCase()
  return HOT_KEYWORDS.some(kw => text.includes(kw))
}

function urgencyFromEmail(from: string): 'high' | 'medium' {
  return isGcContact(from) ? 'high' : 'medium'
}

export const dynamic = 'force-dynamic'

export async function GET() {
  return runSync()
}

export async function POST() {
  return runSync()
}

async function runSync() {
  const db = createServerClient()

  const { data: tokenRow } = await db
    .from('integration_tokens')
    .select('*')
    .eq('service', 'google')
    .single()

  if (!tokenRow) {
    return NextResponse.json({ error: 'Google not connected', messages: [], ok: false }, { status: 200 })
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
      return NextResponse.json({ error: 'Token refresh failed', messages: [], ok: false }, { status: 200 })
    }
  }

  let newInboundItems = 0

  try {
    // Fetch unread messages — prioritize GC contacts and hot keywords
    const listData = await getGmailMessages(accessToken, 'is:unread -category:promotions -category:social', 15)
    const messageIds: string[] = (listData.messages || []).map((m: { id: string }) => m.id)

    const messages = await Promise.all(
      messageIds.slice(0, 15).map(async (id) => {
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
            isHot: isHotEmail(subject, msg.snippet || '', from),
            snippet: msg.snippet || '',
          }
        } catch {
          return null
        }
      })
    )

    const filtered = (messages.filter(Boolean) as NonNullable<typeof messages[0]>[])
      .filter(m => m.isHot)  // only inbox-worthy emails

    // Sort: GC contacts first
    filtered.sort((a, b) => {
      if (a.isGc && !b.isGc) return -1
      if (!a.isGc && b.isGc) return 1
      return 0
    })

    // Write hot emails to inbound_items (upsert to avoid duplicates)
    for (const msg of filtered) {
      const urgency = urgencyFromEmail(msg.from)
      // Extract sender name from "Name <email@domain.com>" format
      const nameMatch = msg.from.match(/^"?([^"<]+)"?\s*</i)
      const senderName = nameMatch ? nameMatch[1].trim() : msg.from.split('@')[0]
      const emailMatch = msg.from.match(/<([^>]+)>/)
      const senderEmail = emailMatch ? emailMatch[1] : msg.from

      const SLA_MINUTES = urgency === 'high' ? 120 : 240
      const slaDeadline = new Date(Date.now() + SLA_MINUTES * 60_000).toISOString()

      const tags: string[] = ['gmail']
      if (msg.isGc) tags.push('gc-contact')
      if (urgency === 'high') tags.push('priority-sender')
      HOT_KEYWORDS.forEach(kw => {
        if ([msg.subject, msg.snippet].join(' ').toLowerCase().includes(kw)) {
          if (!tags.includes(kw)) tags.push(kw)
        }
      })

      await db.from('inbound_items').upsert({
        source: 'gmail',
        source_id: msg.id,
        contact_name: senderName,
        email: senderEmail,
        subject: msg.subject || '(no subject)',
        body_preview: msg.snippet || null,
        urgency,
        tags,
        status: 'new',
        sla_deadline: slaDeadline,
        sla_rule: urgency === 'high' ? 'Gmail Hot Lead' : 'Gmail Important',
      }, { onConflict: 'source,source_id', ignoreDuplicates: true })

      newInboundItems++
    }

    await db.from('app_settings').upsert(
      { key: 'last_google_sync', value: new Date().toISOString(), description: 'Last Google/Gmail sync timestamp' },
      { onConflict: 'key' }
    )

    return NextResponse.json({
      ok: true,
      messages: filtered,
      new_inbound_items: newInboundItems,
      total_unread: listData.resultSizeEstimate || filtered.length,
      fetched_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[sync/gmail] error:', err)
    return NextResponse.json({ error: String(err), messages: [], ok: false }, { status: 200 })
  }
}
