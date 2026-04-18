import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import {
  getFormSubmissions,
  parseSubmissionFields,
  autoTagGhlSubmission,
  ghlUrgency,
  getContact,
  testConnection,
} from '@/lib/ghl'

export const dynamic = 'force-dynamic'

export async function GET() {
  return runSync()
}

export async function POST() {
  return runSync()
}

async function runSync() {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN
  const locationId = process.env.GHL_LOCATION_ID

  if (!token || !locationId) {
    return NextResponse.json({
      ok: false,
      error: 'GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID must be set',
      setup_required: true,
    }, { status: 200 })  // 200 so health checks don't break
  }

  const db = createServerClient()
  const errors: string[] = []
  let newSubmissions = 0
  let newLeads = 0
  let newInboundItems = 0

  try {
    // Determine sync window — last sync or 7 days back
    const { data: lastSyncSetting } = await db
      .from('app_settings')
      .select('value')
      .eq('key', 'last_ghl_sync')
      .maybeSingle()

    const sinceDate = lastSyncSetting?.value
      ? new Date(lastSyncSetting.value).toISOString()
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { submissions } = await getFormSubmissions({
      startAt: sinceDate,
      limit: 100,
    })

    for (const sub of submissions) {
      try {
        // Skip if already processed
        const { data: existing } = await db
          .from('ghl_submissions')
          .select('id')
          .eq('ghl_id', sub.id)
          .maybeSingle()
        if (existing) continue

        // Enrich with contact data if available
        let contact = null
        if (sub.contactId) {
          contact = await getContact(sub.contactId).catch(() => null)
        }

        const rawData = sub.data as Record<string, unknown>
        const fields = parseSubmissionFields({
          ...rawData,
          name: contact?.name ?? rawData.name,
          email: contact?.email ?? rawData.email,
          phone: contact?.phone ?? rawData.phone,
        })

        const tags = autoTagGhlSubmission(fields)
        const urgency = ghlUrgency(fields)

        // Determine service type and estimated value
        const serviceType = fields.service_type || detectServiceType(fields)

        // Insert into ghl_submissions
        const { data: ghlSub, error: subError } = await db
          .from('ghl_submissions')
          .insert({
            ghl_id: sub.id,
            form_id: sub.formId,
            form_name: sub.name,
            contact_id: sub.contactId || null,
            contact_name: fields.name,
            email: fields.email,
            phone: fields.phone,
            message: fields.message,
            service_type: serviceType,
            address: fields.address,
            tags,
            raw_data: rawData,
            processed: false,
            received_at: sub.submittedAt || new Date().toISOString(),
          })
          .select('id')
          .single()

        if (subError) {
          errors.push(`ghl_submissions insert: ${subError.message}`)
          continue
        }
        newSubmissions++

        // Create a lead
        const estimatedValue = estimateValue(tags, fields.message)
        const { data: lead, error: leadError } = await db
          .from('leads')
          .insert({
            name: fields.name,
            email: fields.email,
            phone: fields.phone,
            company: contact?.companyName || extractCompany(fields),
            address: fields.address,
            service_type: serviceType,
            message: fields.message,
            status: 'new',
            source: 'ghl',
            urgency,
            owner: 'carlo',
            next_action: 'Follow up with new website lead',
            next_action_due: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 min SLA
            estimated_value_cents: estimatedValue,
            tags,
            pipeline_stage: 'new',
            last_activity_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (leadError) {
          errors.push(`lead insert: ${leadError.message}`)
        } else {
          newLeads++
          // Link lead to ghl submission
          await db.from('ghl_submissions').update({ lead_id: lead.id, processed: true }).eq('id', ghlSub.id)

          // Create inbound item
          const slaDeadline = new Date(Date.now() + 15 * 60 * 1000).toISOString()
          const { data: inboundItem } = await db
            .from('inbound_items')
            .insert({
              source: 'ghl',
              source_id: sub.id,
              contact_name: fields.name,
              phone: fields.phone,
              email: fields.email,
              company: contact?.companyName || extractCompany(fields),
              subject: `Website Form — ${serviceType || 'Inquiry'}`,
              body_preview: fields.message ? fields.message.slice(0, 150) : null,
              urgency,
              tags,
              status: 'new',
              sla_deadline: slaDeadline,
              sla_rule: 'GHL Form Submission',
              lead_id: lead.id,
            })
            .select('id')
            .single()

          if (inboundItem) {
            await db.from('ghl_submissions').update({ inbound_item_id: inboundItem.id }).eq('id', ghlSub.id)
            newInboundItems++
          }

          // Activity feed
          await db.from('activity_feed').insert({
            event_type: 'new_lead',
            title: `New lead from website — ${fields.name}`,
            description: serviceType ? `Service: ${serviceType}` : fields.message?.slice(0, 80) || null,
            lead_id: lead.id,
          })

          // Telegram notification for high urgency
          if (urgency === 'high') {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
            const mgmtChat = process.env.TELEGRAM_MANAGEMENT_CHAT_ID
            if (mgmtChat && process.env.TELEGRAM_BOT_TOKEN) {
              await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: mgmtChat,
                  text: `🚨 <b>Urgent Website Lead</b>\n\n<b>${fields.name}</b>${contact?.companyName ? ` — ${contact.companyName}` : ''}\n${serviceType ? `Service: ${serviceType}\n` : ''}${fields.phone ? `Phone: ${fields.phone}\n` : ''}${fields.message ? `\n"${fields.message.slice(0, 100)}"` : ''}\n\n<a href="${appUrl}/inbox">View in Inbox →</a>`,
                  parse_mode: 'HTML',
                  disable_web_page_preview: true,
                }),
              }).catch(() => {})
            }
          }
        }
      } catch (subErr) {
        errors.push(`submission ${sub.id}: ${String(subErr)}`)
      }
    }

    // Update last sync time
    await db.from('app_settings').upsert(
      { key: 'last_ghl_sync', value: new Date().toISOString(), description: 'Last GHL form sync timestamp' },
      { onConflict: 'key' }
    )

    return NextResponse.json({
      ok: true,
      synced: { submissions: newSubmissions, leads: newLeads, inbound_items: newInboundItems },
      errors,
      synced_at: new Date().toISOString(),
    })
  } catch (err) {
    const errMsg = String(err)
    console.error('[sync/ghl] Error:', err)

    await db.from('app_settings').upsert(
      { key: 'ghl_last_error', value: errMsg, description: 'Last GHL sync error' },
      { onConflict: 'key' }
    )

    return NextResponse.json({ ok: false, error: errMsg }, { status: 200 })
  }
}

function detectServiceType(fields: { message: string | null; service_type: string | null }): string {
  const text = [fields.message, fields.service_type].join(' ').toLowerCase()
  if (/post.?construct|new build|new construction/.test(text)) return 'Post-Construction Clean'
  if (/final clean/.test(text)) return 'Final Clean'
  if (/rough clean/.test(text)) return 'Rough Clean'
  if (/window/.test(text)) return 'Window Cleaning'
  if (/pressure|power wash/.test(text)) return 'Pressure Washing'
  if (/deep clean|detail/.test(text)) return 'Deep Clean'
  if (/residential|house|home/.test(text)) return 'Residential Clean'
  return 'General Inquiry'
}

function estimateValue(tags: string[], message: string | null): number {
  const text = (message || '').toLowerCase()
  const hasSqft = /(\d{4,5})\s*sq/.exec(text)
  if (hasSqft) {
    const sqft = parseInt(hasSqft[1])
    const rate = tags.includes('commercial') ? 0.35 : 0.25  // $/sqft rough estimate
    return Math.round(sqft * rate * 100) // cents
  }
  if (tags.includes('commercial')) return 450000 // $4,500 avg
  if (tags.includes('post-construction')) return 350000 // $3,500 avg
  return 150000 // $1,500 default
}

function extractCompany(fields: { message: string | null }): string | null {
  if (!fields.message) return null
  const match = /(LLC|Inc|Corp|Construction|Development|Homes|Build|Group|Realty|Properties)/i.exec(fields.message)
  if (match) {
    const idx = fields.message.indexOf(match[0])
    const before = fields.message.slice(Math.max(0, idx - 30), idx).split(/\s+/).slice(-3)
    return [...before, match[0]].join(' ').trim() || null
  }
  return null
}
