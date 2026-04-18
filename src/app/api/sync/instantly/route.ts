import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getReceivedEmails, classifyReply } from '@/lib/instantly'

export const dynamic = 'force-dynamic'

export async function GET() {
  return runSync()
}

export async function POST() {
  return runSync()
}

async function runSync() {
  const apiKey = process.env.INSTANTLY_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: 'INSTANTLY_API_KEY is not set',
      setup_required: true,
    }, { status: 200 })
  }

  const db = createServerClient()
  const errors: string[] = []
  let newReplies = 0
  let positiveReplies = 0
  let newLeads = 0
  let newInboundItems = 0

  try {
    const emails = await getReceivedEmails({ limit: 50 })

    for (const email of emails) {
      try {
        // Skip if already stored
        const { data: existing } = await db
          .from('instantly_replies')
          .select('id')
          .eq('instantly_id', email.id)
          .maybeSingle()
        if (existing) continue

        // v2: from_address_email, body is { text, html } object
        const fromEmail = email.from_address_email
        const bodyText = email.body?.text ?? null
        const campaignName = email.lead?.companyName ?? email.campaign_id
        const timestamp = email.timestamp_email || email.timestamp_created

        const { sentiment, tags } = classifyReply(email.subject, bodyText)

        // Insert into instantly_replies
        const { data: reply, error: replyError } = await db
          .from('instantly_replies')
          .insert({
            instantly_id: email.id,
            campaign_id: email.campaign_id,
            campaign_name: campaignName,
            from_email: fromEmail,
            from_name: extractName(fromEmail),
            subject: email.subject,
            body_preview: bodyText ? bodyText.replace(/<[^>]+>/g, '').slice(0, 200) : null,
            sentiment,
            tags,
            processed: false,
            received_at: timestamp,
          })
          .select('id')
          .single()

        if (replyError) {
          errors.push(`instantly_replies insert: ${replyError.message}`)
          continue
        }
        newReplies++

        // Only create leads + inbox items for positive replies
        if (sentiment === 'positive') {
          positiveReplies++

          const contactName = extractName(fromEmail)
          const domain = fromEmail.split('@')[1] || ''
          const isCommercial = isCommercialDomain(domain)

          // Create lead
          const { data: lead, error: leadError } = await db
            .from('leads')
            .insert({
              name: contactName,
              email: fromEmail,
              source: 'instantly',
              status: 'contacted',
              urgency: 'high',
              owner: 'carlo',
              next_action: buildInstantlyNextAction(tags, email.subject),
              next_action_due: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), // 8h SLA
              tags: [...tags, 'cold-outreach-reply'],
              pipeline_stage: 'contacted',
              last_activity_at: new Date().toISOString(),
              notes: `Campaign: ${campaignName}\nSubject: ${email.subject || '(no subject)'}\n\n${bodyText ? bodyText.slice(0, 500) : ''}`,
            })
            .select('id')
            .single()

          if (leadError) {
            errors.push(`lead insert (instantly): ${leadError.message}`)
          } else {
            newLeads++
            await db.from('instantly_replies').update({ lead_id: lead.id, processed: true }).eq('id', reply.id)

            // Create inbound item
            const slaDeadline = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
            const { data: inboundItem } = await db
              .from('inbound_items')
              .insert({
                source: 'instantly',
                source_id: email.id,
                contact_name: contactName,
                email: fromEmail,
                company: isCommercial ? domain.split('.')[0] : null,
                subject: email.subject || '(no subject)',
                body_preview: bodyText ? bodyText.slice(0, 150) : null,
                urgency: 'high',
                tags: [...tags, 'cold-outreach-reply'],
                status: 'new',
                sla_deadline: slaDeadline,
                sla_rule: 'Instantly Positive Reply',
                lead_id: lead.id,
              })
              .select('id')
              .single()

            if (inboundItem) {
              await db.from('instantly_replies').update({ inbound_item_id: inboundItem.id }).eq('id', reply.id)
              newInboundItems++
            }

            // Activity feed
            await db.from('activity_feed').insert({
              event_type: 'new_lead',
              title: `Instantly reply — ${contactName}`,
              description: `${email.subject || '(no subject)'} · Campaign: ${campaignName}`,
              lead_id: lead.id,
            })

            // Telegram alert
            const mgmtChat = process.env.TELEGRAM_MANAGEMENT_CHAT_ID || '-5218394283'
            if (mgmtChat && process.env.TELEGRAM_BOT_TOKEN) {
              const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
              await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: mgmtChat,
                  text: `📧 <b>Instantly Reply — Action Needed</b>\n\nFrom: <b>${contactName}</b> (${fromEmail})\nSubject: ${email.subject || '(no subject)'}\n\n<a href="${appUrl}/inbox">View in Inbox →</a>`,
                  parse_mode: 'HTML',
                  disable_web_page_preview: true,
                }),
              }).catch(() => {})
            }
          }
        }
      } catch (emailErr) {
        errors.push(`email ${email.id}: ${String(emailErr)}`)
      }
    }

    await db.from('app_settings').upsert(
      { key: 'last_instantly_sync', value: new Date().toISOString(), description: 'Last Instantly sync timestamp' },
      { onConflict: 'key' }
    )

    return NextResponse.json({
      ok: true,
      synced: { total: newReplies, positive: positiveReplies, leads: newLeads, inbound_items: newInboundItems },
      errors,
      synced_at: new Date().toISOString(),
    })
  } catch (err) {
    const errMsg = String(err)
    console.error('[sync/instantly] Error:', err)
    await db.from('app_settings').upsert(
      { key: 'instantly_last_error', value: errMsg, description: 'Last Instantly sync error' },
      { onConflict: 'key' }
    )
    return NextResponse.json({ ok: false, error: errMsg }, { status: 200 })
  }
}

function buildInstantlyNextAction(tags: string[], subject: string | null): string {
  const sub = (subject || '').toLowerCase()
  if (tags.includes('estimate-request') || /estimate|quote|price|pricing/.test(sub)) {
    return 'Send estimate — expressed interest in pricing'
  }
  if (tags.includes('scheduling') || /schedule|meeting|call|available|availability/.test(sub)) {
    return 'Schedule a call or walkthrough'
  }
  if (tags.includes('builder') || tags.includes('property-manager')) {
    return 'Call to discuss ongoing cleaning contract'
  }
  if (tags.includes('referral')) {
    return 'Follow up — came via referral, high intent'
  }
  return 'Reply to cold outreach response — warm lead'
}

function extractName(email: string): string {
  const local = email.split('@')[0]
  return local
    .replace(/[._-]/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase()) || email
}

function isCommercialDomain(domain: string): boolean {
  const personal = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'me.com']
  return !personal.includes(domain.toLowerCase())
}
