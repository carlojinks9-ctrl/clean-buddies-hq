import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { normalizePhone, QUO_MISSED_STATUSES } from '@/lib/quo'
import { analyzeAndFlag } from '@/lib/ai-flag'
import { notifyJobStatusChange } from '@/lib/telegram'

// Always return 200 so Quo doesn't retry
export async function POST(request: NextRequest) {
  let payload: Record<string, unknown>
  try {
    const raw = await request.text()
    console.log('[quo/webhook] Received:', raw.slice(0, 500))
    payload = JSON.parse(raw)
  } catch (err) {
    console.error('[quo/webhook] Parse error:', err)
    return NextResponse.json({ ok: true })
  }

  const eventType = String(payload.type || payload.event || '')
  const obj = (payload.object || payload.data || {}) as Record<string, unknown>

  console.log('[quo/webhook] Event type:', eventType)

  let db: ReturnType<typeof createServerClient>
  try {
    db = createServerClient()
  } catch (err) {
    console.error('[quo/webhook] Supabase init failed:', err)
    return NextResponse.json({ ok: true })
  }

  // ── Build phone → client lookup ────────────────────────────────────────
  async function resolveClient(phone: string) {
    const normalized = normalizePhone(phone)
    const { data } = await db
      .from('clients')
      .select('id, name, phone')
      .filter('phone', 'ilike', `%${normalized.slice(-7)}%`)
      .limit(5)
    if (!data?.length) return null
    // Find best match
    return (data as Array<{ id: string; name: string; phone: string | null }>)
      .find(c => normalizePhone(c.phone ?? '') === normalized) ?? null
  }

  async function resolveContactName(phone: string) {
    const normalized = normalizePhone(phone)
    const client = await resolveClient(phone)
    if (client) return { name: client.name, clientId: client.id }

    const { data: qc } = await db
      .from('quo_contacts')
      .select('name')
      .eq('phone', normalized)
      .maybeSingle()
    return { name: qc?.name ?? null, clientId: null as string | null }
  }

  // ── call.completed ─────────────────────────────────────────────────────
  if (eventType === 'call.completed') {
    try {
      const quoId = String(obj.id || '')
      const direction = String(obj.direction || 'inbound') as 'inbound' | 'outbound'
      const from = String(obj.from || '')
      const to = String(obj.to || '')
      const duration = Number(obj.duration) || null
      const status = String(obj.status || '')
      const recording = obj.recording as { url?: string } | null
      const summary = obj.summary ? String(obj.summary) : null
      const transcript = obj.transcript ? String(obj.transcript) : null
      const tags = Array.isArray(obj.tags) ? obj.tags as string[] : null
      const phoneNumberId = obj.phoneNumberId ? String(obj.phoneNumberId) : null
      const userId = obj.userId ? String(obj.userId) : null
      const createdAt = obj.createdAt ? String(obj.createdAt) : new Date().toISOString()

      const externalPhone = direction === 'inbound' ? from : to
      const { name: contactName, clientId } = await resolveContactName(externalPhone)

      // AI flagging
      const analysisContent = summary || transcript || ''
      let flagData = { is_flagged: false, flag_reason: null as string | null, aiTags: null as string[] | null }
      if (analysisContent) {
        const result = await analyzeAndFlag(analysisContent)
        flagData = { is_flagged: result.is_flagged, flag_reason: result.flag_reason, aiTags: result.tags.length > 0 ? result.tags : null }
      } else if (!clientId && direction === 'inbound' && QUO_MISSED_STATUSES.has(status)) {
        flagData = { is_flagged: true, flag_reason: 'Unknown caller — missed inbound call', aiTags: ['unknown-caller', 'missed-opportunity'] }
      }

      await db.from('quo_calls').upsert({
        quo_id: quoId,
        direction,
        from_number: from,
        to_number: to,
        duration_seconds: duration,
        status,
        recording_url: recording?.url ?? null,
        transcript,
        ai_summary: summary,
        ai_tags: flagData.aiTags,
        contact_name: contactName,
        phone_number_id: phoneNumberId,
        user_id: userId,
        is_flagged: flagData.is_flagged,
        flag_reason: flagData.flag_reason,
        client_id: clientId,
        created_at: createdAt,
      }, { onConflict: 'quo_id' })

      // Activity feed
      const displayName = contactName ?? externalPhone
      await db.from('activity_feed').insert({
        event_type: QUO_MISSED_STATUSES.has(status) ? 'quo_missed_call' : 'quo_call',
        title: QUO_MISSED_STATUSES.has(status)
          ? `Missed call from ${displayName}`
          : `${direction === 'inbound' ? 'Inbound' : 'Outbound'} call — ${displayName}`,
        description: duration ? `Duration: ${Math.floor(duration / 60)}m ${duration % 60}s` : null,
        metadata: { quo_id: quoId, direction, phone: externalPhone, is_flagged: flagData.is_flagged },
        client_id: clientId,
      })

      // Immediately surface missed calls in the unified inbox
      if (direction === 'inbound' && QUO_MISSED_STATUSES.has(status)) {
        const SLA_MINUTES = 10
        const slaDeadline = new Date(new Date(createdAt).getTime() + SLA_MINUTES * 60_000).toISOString()
        const minAgo = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000)
        await db.from('inbound_items').upsert({
          source: 'quo_call',
          source_id: quoId,
          contact_name: contactName,
          phone: externalPhone,
          subject: `Missed call — ${displayName}`,
          body_preview: flagData.flag_reason ?? `${status} · ${minAgo}m ago — needs callback`,
          urgency: 'high',
          tags: Array.from(new Set(['missed-call', 'callback-needed', ...(flagData.aiTags ?? [])])),
          status: 'new',
          sla_deadline: slaDeadline,
          sla_breached: minAgo > SLA_MINUTES,
          sla_rule: 'Quo Missed Call',
        }, { onConflict: 'source,source_id', ignoreDuplicates: false })

        // Telegram alert for ALL missed calls (not just AI-flagged ones)
        const mgmtChat = process.env.TELEGRAM_MANAGEMENT_CHAT_ID
        if (mgmtChat && process.env.TELEGRAM_BOT_TOKEN) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: mgmtChat,
              text: `📵 <b>Missed Call</b>\n\nFrom: <b>${displayName}</b>${!clientId ? ' (unknown)' : ''}\nStatus: ${status}\n\nCallback SLA: ${SLA_MINUTES} min\n<a href="${appUrl}/inbox">View Inbox →</a>`,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          }).catch(e => console.error('[quo/webhook] Telegram notify error:', e))
        }
      } else if (flagData.is_flagged) {
        // Non-missed flagged call (e.g., concerning conversation)
        const mgmtChat = process.env.TELEGRAM_MANAGEMENT_CHAT_ID
        if (mgmtChat && process.env.TELEGRAM_BOT_TOKEN) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: mgmtChat,
              text: `🚨 <b>Flagged Call</b>\n\nFrom: <b>${displayName}</b> (${direction})\n${flagData.flag_reason ? `Reason: ${flagData.flag_reason}` : ''}\n\n<a href="${appUrl}/inbox">View in Inbox →</a>`,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          }).catch(e => console.error('[quo/webhook] Telegram notify error:', e))
        }
      }
    } catch (err) {
      console.error('[quo/webhook] call.completed error:', err)
    }
  }

  // ── call.summary.completed — enrich existing call with new AI summary ──
  if (eventType === 'call.summary.completed') {
    try {
      const quoId = String(obj.id || obj.callId || '')
      const summary = obj.summary ? String(obj.summary) : null
      const transcript = obj.transcript ? String(obj.transcript) : null

      if (quoId && summary) {
        const flagResult = await analyzeAndFlag(summary)

        await db.from('quo_calls').update({
          ai_summary: summary,
          transcript: transcript ?? undefined,
          is_flagged: flagResult.is_flagged,
          flag_reason: flagResult.flag_reason,
          ai_tags: flagResult.tags.length > 0 ? flagResult.tags : undefined,
        }).eq('quo_id', quoId)
      }
    } catch (err) {
      console.error('[quo/webhook] call.summary.completed error:', err)
    }
  }

  // ── message.received ───────────────────────────────────────────────────
  if (eventType === 'message.received' || eventType === 'message.sent') {
    try {
      const quoId = String(obj.id || '')
      const direction = eventType === 'message.received' ? 'inbound' : 'outbound'
      const from = String(obj.from || '')
      const to = String(obj.to || '')
      const body = obj.body ? String(obj.body) : null
      const phoneNumberId = obj.phoneNumberId ? String(obj.phoneNumberId) : null
      const userId = obj.userId ? String(obj.userId) : null
      const msgCreatedAt = obj.createdAt ? String(obj.createdAt) : new Date().toISOString()

      const externalPhone = direction === 'inbound' ? from : to
      const { name: contactName, clientId } = await resolveContactName(externalPhone)

      let flagData = { is_flagged: false, flag_reason: null as string | null }
      if (direction === 'inbound' && body) {
        const result = await analyzeAndFlag(body)
        flagData = { is_flagged: result.is_flagged, flag_reason: result.flag_reason }
      }

      const { error } = await db.from('quo_messages').upsert({
        quo_id: quoId,
        direction,
        from_number: from,
        to_number: to,
        body,
        contact_name: contactName,
        phone_number_id: phoneNumberId,
        user_id: userId,
        is_flagged: flagData.is_flagged,
        flag_reason: flagData.flag_reason,
        client_id: clientId,
        created_at: msgCreatedAt,
      }, { onConflict: 'quo_id' })

      if (!error && direction === 'inbound') {
        await db.from('activity_feed').insert({
          event_type: 'quo_message',
          title: `Message from ${contactName ?? externalPhone}`,
          description: body ? body.slice(0, 100) : null,
          metadata: { quo_id: quoId, direction, phone: externalPhone, is_flagged: flagData.is_flagged },
          client_id: clientId,
        })

        // Immediately surface ALL inbound messages in the unified inbox
        const SLA_MINUTES = 30
        const msgCreatedAt = obj.createdAt ? String(obj.createdAt) : new Date().toISOString()
        const slaDeadline = new Date(new Date(msgCreatedAt).getTime() + SLA_MINUTES * 60_000).toISOString()
        const minAgo = Math.floor((Date.now() - new Date(msgCreatedAt).getTime()) / 60_000)
        const urgency = flagData.is_flagged ? 'high' : (minAgo > SLA_MINUTES ? 'high' : 'medium')

        await db.from('inbound_items').upsert({
          source: 'quo_message',
          source_id: quoId,
          contact_name: contactName,
          phone: externalPhone,
          subject: `Text from ${contactName ?? externalPhone}`,
          body_preview: body ? body.slice(0, 150) : 'Inbound SMS',
          urgency,
          tags: ['inbound-text', 'reply-needed', ...(flagData.is_flagged ? ['flagged'] : [])],
          status: 'new',
          sla_deadline: slaDeadline,
          sla_breached: minAgo > SLA_MINUTES,
          sla_rule: 'Quo Inbound Text',
        }, { onConflict: 'source,source_id', ignoreDuplicates: false })

        // Telegram alert for all inbound messages
        const mgmtChat = process.env.TELEGRAM_MANAGEMENT_CHAT_ID
        if (mgmtChat && process.env.TELEGRAM_BOT_TOKEN) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
          const preview = body ? body.slice(0, 100) : '(no body)'
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: mgmtChat,
              text: `${flagData.is_flagged ? '🚨' : '💬'} <b>Inbound Text${flagData.is_flagged ? ' — Flagged' : ''}</b>\n\nFrom: <b>${contactName ?? externalPhone}</b>\n"${preview}"\n\nReply SLA: ${SLA_MINUTES} min\n<a href="${appUrl}/inbox">View Inbox →</a>`,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          }).catch(e => console.error('[quo/webhook] Telegram notify error:', e))
        }
      }
    } catch (err) {
      console.error('[quo/webhook] message event error:', err)
    }
  }

  return NextResponse.json({ ok: true })
}
