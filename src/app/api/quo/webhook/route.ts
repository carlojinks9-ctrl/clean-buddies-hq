import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { normalizePhone, QUO_MISSED_STATUSES } from '@/lib/quo'
import { analyzeAndFlag } from '@/lib/ai-flag'
import { MGMT_CHAT_ID } from '@/lib/telegram'
import crypto from 'node:crypto'

// Always return 200 so Quo doesn't retry on application errors
export async function POST(request: NextRequest) {
  const raw = await request.text()

  // ── Signature verification ──────────────────────────────────────────────
  const signingSecret = process.env.QUO_WEBHOOK_SIGNING_SECRET
  const sigHeader = request.headers.get('openphone-signature')

  if (signingSecret && sigHeader) {
    // Format: hmac;1;{timestamp};{base64-signature}
    const parts = sigHeader.split(';')
    if (parts.length >= 4) {
      const timestamp = parts[2]
      const providedDigest = parts[3]
      // Signed data = timestamp + "." + compact JSON
      const signedData = timestamp + '.' + JSON.stringify(JSON.parse(raw))
      const keyBinary = Buffer.from(signingSecret, 'base64').toString('binary')
      const computedDigest = crypto.createHmac('sha256', keyBinary)
        .update(Buffer.from(signedData, 'utf8'))
        .digest('base64')

      if (providedDigest !== computedDigest) {
        console.error('[quo/webhook] Signature verification FAILED')
        // Return 200 anyway to prevent Quo from retrying bad-sig payloads indefinitely,
        // but log the failure. Change to 401 once you've confirmed verification works.
        return NextResponse.json({ ok: true, verified: false })
      }
    }
  } else if (signingSecret && !sigHeader) {
    console.warn('[quo/webhook] Signing secret set but no openphone-signature header received')
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw)
  } catch (err) {
    console.error('[quo/webhook] JSON parse error:', err)
    return NextResponse.json({ ok: true })
  }

  // ── Extract event data ──────────────────────────────────────────────────
  // Real payload structure: { type, data: { object: { ...actual fields... } } }
  const eventType = String(payload.type || '')
  const dataWrapper = payload.data as Record<string, unknown> | undefined
  const obj = (dataWrapper?.object ?? {}) as Record<string, unknown>

  console.log('[quo/webhook] Event:', eventType, '| obj.id:', obj.id ?? obj.callId ?? '—')

  // ── Direction normalization ─────────────────────────────────────────────
  // Webhook uses "incoming"/"outgoing"; our DB constraint requires "inbound"/"outbound"
  function normalizeDirection(dir: unknown): 'inbound' | 'outbound' {
    const d = String(dir || '')
    if (d === 'incoming' || d === 'inbound') return 'inbound'
    if (d === 'outgoing' || d === 'outbound') return 'outbound'
    return 'inbound'
  }

  let db: ReturnType<typeof createServerClient>
  try {
    db = createServerClient()
  } catch (err) {
    console.error('[quo/webhook] Supabase init failed:', err)
    return NextResponse.json({ ok: true })
  }

  // ── Phone → client/contact lookup ──────────────────────────────────────
  async function resolveContactName(phone: string): Promise<{ name: string | null; clientId: string | null }> {
    const normalized = normalizePhone(phone)

    // Check clients first
    const { data: clients } = await db
      .from('clients')
      .select('id, name, phone')
      .filter('phone', 'ilike', `%${normalized.slice(-7)}%`)
      .limit(5)

    if (clients?.length) {
      const exact = (clients as Array<{ id: string; name: string; phone: string | null }>)
        .find(c => normalizePhone(c.phone ?? '') === normalized)
      if (exact) return { name: exact.name, clientId: exact.id }
    }

    // Check quo_contacts
    const { data: qc } = await db
      .from('quo_contacts')
      .select('name')
      .eq('phone', normalized)
      .maybeSingle()

    return { name: qc?.name ?? null, clientId: null }
  }

  // ── call.completed ──────────────────────────────────────────────────────
  if (eventType === 'call.completed') {
    try {
      const quoId = String(obj.id || '')
      const direction = normalizeDirection(obj.direction)
      const from = String(obj.from || '')
      const to = String(obj.to || '')
      const status = String(obj.status || 'completed')
      const phoneNumberId = obj.phoneNumberId ? String(obj.phoneNumberId) : null
      const userId = obj.userId ? String(obj.userId) : null
      const conversationId = obj.conversationId ? String(obj.conversationId) : null
      const createdAt = obj.createdAt ? String(obj.createdAt) : new Date().toISOString()
      const answeredAt = obj.answeredAt ? String(obj.answeredAt) : null
      const completedAt = obj.completedAt ? String(obj.completedAt) : null

      // Duration: webhook has no top-level duration field; calculate from timestamps
      let durationSeconds: number | null = null
      if (answeredAt && completedAt) {
        durationSeconds = Math.round(
          (new Date(completedAt).getTime() - new Date(answeredAt).getTime()) / 1000
        )
      }

      // Voicemail: distinct field, not recording
      const voicemailObj = obj.voicemail as { url?: string; type?: string; duration?: number } | null
      const voicemailUrl = voicemailObj?.url ?? null
      const voicemailDuration = voicemailObj?.duration ?? null

      // Recording comes via call.recording.completed (separate event); media may be empty here

      // Missed call: direction=incoming and answeredAt=null (regardless of status field)
      // The webhook always sends status="completed" for call.completed events.
      const isMissedCall = direction === 'inbound' && answeredAt === null

      const externalPhone = direction === 'inbound' ? from : to
      const { name: contactName, clientId } = await resolveContactName(externalPhone)
      const displayName = contactName ?? externalPhone

      // AI flagging — only if there's content to analyze (summary/transcript come later)
      let flagData = { is_flagged: false, flag_reason: null as string | null, aiTags: null as string[] | null }
      if (isMissedCall && !clientId) {
        flagData = {
          is_flagged: true,
          flag_reason: 'Unknown caller — missed inbound call',
          aiTags: ['unknown-caller', 'missed-opportunity'],
        }
      }

      await db.from('quo_calls').upsert({
        quo_id: quoId,
        direction,
        from_number: from,
        to_number: to,
        duration_seconds: durationSeconds,
        status: isMissedCall ? 'missed' : status,  // normalize status for our DB
        voicemail_url: voicemailUrl,
        voicemail_duration: voicemailDuration,
        answered_at: answeredAt,
        completed_at: completedAt,
        conversation_id: conversationId,
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
      await db.from('activity_feed').insert({
        event_type: isMissedCall ? 'quo_missed_call' : 'quo_call',
        title: isMissedCall
          ? `Missed call from ${displayName}`
          : `${direction === 'inbound' ? 'Inbound' : 'Outbound'} call — ${displayName}`,
        description: durationSeconds
          ? `Duration: ${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`
          : voicemailUrl ? 'Voicemail left' : null,
        metadata: { quo_id: quoId, direction, phone: externalPhone, is_flagged: flagData.is_flagged },
        client_id: clientId,
      })

      // Missed calls → immediately into inbox with 10-min SLA
      if (isMissedCall) {
        const SLA_MINUTES = 10
        const slaDeadline = new Date(new Date(createdAt).getTime() + SLA_MINUTES * 60_000).toISOString()
        const minAgo = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000)

        const callTags = ['missed-call', 'callback-needed']
        if (voicemailUrl) callTags.push('voicemail')
        if (!clientId) callTags.push('unknown-caller')

        await db.from('inbound_items').upsert({
          source: 'quo_call',
          source_id: quoId,
          contact_name: contactName,
          phone: externalPhone,
          subject: `Missed call — ${displayName}`,
          body_preview: voicemailUrl
            ? `Voicemail left · ${minAgo}m ago — listen and callback`
            : `${minAgo}m ago — no answer, needs callback`,
          urgency: 'high',
          tags: Array.from(new Set(callTags)),
          status: 'new',
          sla_deadline: slaDeadline,
          sla_breached: minAgo > SLA_MINUTES,
          sla_rule: 'Quo Missed Call',
        }, { onConflict: 'source,source_id', ignoreDuplicates: false })

        // Telegram alert for all missed calls
        const mgmtChat = MGMT_CHAT_ID
        if (mgmtChat && process.env.TELEGRAM_BOT_TOKEN) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
          const vmNote = voicemailUrl ? '\nVoicemail: left ✓' : ''
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: mgmtChat,
              text: `📵 <b>Missed Call</b>\n\nFrom: <b>${displayName}</b>${!clientId ? ' (unknown)' : ''}${vmNote}\n\nCallback SLA: ${SLA_MINUTES} min\n<a href="${appUrl}/inbox">View Inbox →</a>`,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          }).catch(e => console.error('[quo/webhook] Telegram error:', e))
        }
      }
    } catch (err) {
      console.error('[quo/webhook] call.completed error:', err)
    }
  }

  // ── call.recording.completed ────────────────────────────────────────────
  // Recording arrives as a separate event; update the call record with the URL
  // data.object.callId = the parent call ID; data.object.id = the recording ID
  if (eventType === 'call.recording.completed') {
    try {
      const quoId = String(obj.callId || obj.id || '')
      const media = obj.media as Array<{ url?: string; type?: string; duration?: number }> | null
      const recordingUrl = media?.find(m => m.type?.startsWith('audio'))?.url
        ?? (typeof obj.recordingUrl === 'string' ? obj.recordingUrl : null)

      if (quoId && recordingUrl) {
        await db.from('quo_calls').update({ recording_url: recordingUrl }).eq('quo_id', quoId)
        console.log('[quo/webhook] recording URL saved for call:', quoId)
      } else {
        console.warn('[quo/webhook] call.recording.completed — no callId or recordingUrl found in obj:', JSON.stringify(obj).slice(0, 300))
      }
    } catch (err) {
      console.error('[quo/webhook] call.recording.completed error:', err)
    }
  }

  // ── call.summary.completed ──────────────────────────────────────────────
  // v3 payload: data.object = { object:"callSummary", callId, summary:string[], nextSteps:string[] }
  if (eventType === 'call.summary.completed') {
    try {
      const callId = String(obj.callId || obj.id || '')
      // summary is string[] in v3 payloads
      const rawSummary = obj.summary
      const summaryText = Array.isArray(rawSummary)
        ? rawSummary.join('\n')
        : rawSummary ? String(rawSummary) : null

      const rawNextSteps = obj.nextSteps
      const nextSteps = Array.isArray(rawNextSteps) ? rawNextSteps as string[] : null

      if (callId && summaryText) {
        const flagResult = await analyzeAndFlag(summaryText)

        await db.from('quo_calls').update({
          ai_summary: summaryText,
          next_steps: nextSteps,
          is_flagged: flagResult.is_flagged || undefined,
          flag_reason: flagResult.flag_reason || undefined,
          ai_tags: flagResult.tags.length > 0 ? flagResult.tags : undefined,
        }).eq('quo_id', callId)

        // If AI flags the call content, surface it in inbox
        if (flagResult.is_flagged) {
          const { data: call } = await db
            .from('quo_calls')
            .select('contact_name, from_number, direction')
            .eq('quo_id', callId)
            .maybeSingle()

          const displayName = call?.contact_name ?? call?.from_number ?? 'Unknown'
          const mgmtChat = MGMT_CHAT_ID
          if (mgmtChat && process.env.TELEGRAM_BOT_TOKEN) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
            await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: mgmtChat,
                text: `🚨 <b>Flagged Call Summary</b>\n\nCall with: <b>${displayName}</b>\nReason: ${flagResult.flag_reason}\n\nSummary: "${summaryText.slice(0, 150)}"\n\n<a href="${appUrl}/inbox">View Inbox →</a>`,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
              }),
            }).catch(e => console.error('[quo/webhook] Telegram error:', e))
          }
        }
      }
    } catch (err) {
      console.error('[quo/webhook] call.summary.completed error:', err)
    }
  }

  // ── call.transcript.completed ───────────────────────────────────────────
  // v3 payload: data.object = { object:"callTranscript", callId, dialogue:[...], duration, status }
  if (eventType === 'call.transcript.completed') {
    try {
      const callId = String(obj.callId || obj.id || '')
      const dialogue = obj.dialogue as Array<{ content?: string; identifier?: string; userId?: string }> | null

      if (callId && dialogue?.length) {
        // Convert dialogue to readable transcript text
        const transcriptText = dialogue
          .filter(d => d.content)
          .map(d => `[${d.identifier ?? d.userId ?? '?'}]: ${d.content}`)
          .join('\n')

        if (transcriptText) {
          await db.from('quo_calls')
            .update({ transcript: transcriptText })
            .eq('quo_id', callId)
            .is('transcript', null)  // don't overwrite if already set
        }
      }
    } catch (err) {
      console.error('[quo/webhook] call.transcript.completed error:', err)
    }
  }

  // ── message.received / message.delivered ────────────────────────────────
  // Note: the event is "message.delivered" (not "message.sent") for outbound delivered messages
  if (eventType === 'message.received' || eventType === 'message.delivered') {
    try {
      const quoId = String(obj.id || '')
      const direction = normalizeDirection(obj.direction)
      const from = String(obj.from || '')
      const to = String(obj.to || '')
      const body = obj.body ? String(obj.body) : null
      const status = obj.status ? String(obj.status) : null
      const phoneNumberId = obj.phoneNumberId ? String(obj.phoneNumberId) : null
      const userId = obj.userId ? String(obj.userId) : null
      const conversationId = obj.conversationId ? String(obj.conversationId) : null
      const msgCreatedAt = obj.createdAt ? String(obj.createdAt) : new Date().toISOString()
      const media = obj.media as Array<{ url?: string; type?: string }> | null

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
        status,
        conversation_id: conversationId,
        media: media?.length ? media : null,
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

        // Surface in unified inbox immediately (30-min SLA)
        const SLA_MINUTES = 30
        const slaDeadline = new Date(new Date(msgCreatedAt).getTime() + SLA_MINUTES * 60_000).toISOString()
        const minAgo = Math.floor((Date.now() - new Date(msgCreatedAt).getTime()) / 60_000)
        const urgency = flagData.is_flagged || minAgo > SLA_MINUTES ? 'high' : 'medium'
        const displayName = contactName ?? externalPhone

        await db.from('inbound_items').upsert({
          source: 'quo_message',
          source_id: quoId,
          contact_name: contactName,
          phone: externalPhone,
          subject: `Text from ${displayName}`,
          body_preview: body ? body.slice(0, 150) : 'Inbound SMS',
          urgency,
          tags: ['inbound-text', 'reply-needed', ...(flagData.is_flagged ? ['flagged'] : [])],
          status: 'new',
          sla_deadline: slaDeadline,
          sla_breached: minAgo > SLA_MINUTES,
          sla_rule: 'Quo Inbound Text',
        }, { onConflict: 'source,source_id', ignoreDuplicates: false })

        // Telegram alert
        const mgmtChat = MGMT_CHAT_ID
        if (mgmtChat && process.env.TELEGRAM_BOT_TOKEN) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
          const preview = body ? body.slice(0, 100) : '(no body)'
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: mgmtChat,
              text: `${flagData.is_flagged ? '🚨' : '💬'} <b>Inbound Text${flagData.is_flagged ? ' — Flagged' : ''}</b>\n\nFrom: <b>${displayName}</b>\n"${preview}"\n\nReply SLA: ${SLA_MINUTES} min\n<a href="${appUrl}/inbox">View Inbox →</a>`,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          }).catch(e => console.error('[quo/webhook] Telegram error:', e))
        }
      }
    } catch (err) {
      console.error('[quo/webhook] message event error:', err)
    }
  }

  // ── contact.updated / contact.deleted ───────────────────────────────────
  if (eventType === 'contact.updated' || eventType === 'contact.deleted') {
    try {
      const contactId = String(obj.id || '')
      const firstName = obj.firstName ? String(obj.firstName) : null
      const lastName = obj.lastName ? String(obj.lastName) : null
      const name = [firstName, lastName].filter(Boolean).join(' ') || null
      const company = obj.company ? String(obj.company) : null

      // Extract phone and email from fields array
      const fields = obj.fields as Array<{ name: string; type: string; value: string | null }> | null
      const phoneField = fields?.find(f => f.type === 'phone-number' && f.value)
      const emailField = fields?.find(f => f.type === 'email' && f.value)
      const phone = phoneField?.value ?? null
      const email = emailField?.value ?? null

      if (eventType === 'contact.deleted') {
        if (contactId) {
          await db.from('quo_contacts').delete().eq('quo_id', contactId)
        }
      } else if (name || phone) {
        await db.from('quo_contacts').upsert({
          quo_id: contactId,
          name: name || phone || 'Unknown',
          company,
          email,
          phone: phone ? normalizePhone(phone) : (email ?? ''),
        }, { onConflict: 'quo_id' })
      }
    } catch (err) {
      console.error('[quo/webhook] contact event error:', err)
    }
  }

  // ── call.ringing (log only) ─────────────────────────────────────────────
  if (eventType === 'call.ringing') {
    // Incoming call starting — useful for logging, don't surface in inbox yet
    console.log('[quo/webhook] call.ringing from:', obj.from)
  }

  return NextResponse.json({ ok: true })
}
