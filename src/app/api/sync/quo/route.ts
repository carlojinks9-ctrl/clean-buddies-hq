import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getCalls, getMessages, normalizePhone, QUO_MISSED_STATUSES } from '@/lib/quo'
import { analyzeAndFlag } from '@/lib/ai-flag'

export async function POST() {
  const db = createServerClient()
  const results = { calls: 0, messages: 0, flagged: 0, errors: [] as string[] }

  // ── Build phone → client lookup ────────────────────────────────────────
  const { data: allClients } = await db
    .from('clients')
    .select('id, name, phone')
    .not('phone', 'is', null)

  const phoneToClient = new Map<string, { id: string; name: string }>()
  for (const c of allClients ?? []) {
    if (c.phone) phoneToClient.set(normalizePhone(c.phone), { id: c.id, name: c.name })
  }

  // ── Sync calls ─────────────────────────────────────────────────────────
  try {
    let pageToken: string | null = null
    let pages = 0
    do {
      const { data: calls, nextPageToken } = await getCalls({
        maxResults: 50,
        pageToken: pageToken ?? undefined,
      })
      pageToken = nextPageToken
      pages++

      for (const call of calls) {
        const externalPhone = call.direction === 'inbound' ? call.from : call.to
        const normalizedPhone = normalizePhone(externalPhone)
        const matchedClient = phoneToClient.get(normalizedPhone)

        // Check if already synced
        const { data: existing } = await db
          .from('quo_calls')
          .select('id, is_flagged, ai_summary')
          .eq('quo_id', call.id)
          .maybeSingle()

        if (existing) {
          // Enrich: update transcript/summary/recording if now available
          const hasNewContent =
            (call.summary && !existing.ai_summary) ||
            call.recording?.url

          if (hasNewContent) {
            // Re-run AI on new summary
            let flagUpdate: { is_flagged: boolean; flag_reason: string | null } | null = null
            if (call.summary && !existing.ai_summary && !existing.is_flagged) {
              const flagResult = await analyzeAndFlag(call.summary)
              if (flagResult.is_flagged) {
                flagUpdate = { is_flagged: true, flag_reason: flagResult.flag_reason }
                results.flagged++
              }
            }

            await db
              .from('quo_calls')
              .update({
                transcript: call.transcript ?? undefined,
                ai_summary: call.summary ?? undefined,
                recording_url: call.recording?.url ?? undefined,
                ai_tags: call.tags ?? undefined,
                ...(flagUpdate ?? {}),
              })
              .eq('quo_id', call.id)
          }
          results.calls++
          continue
        }

        // New call — resolve contact name
        let contactName: string | null = matchedClient?.name ?? null
        if (!contactName) {
          const { data: qc } = await db
            .from('quo_contacts')
            .select('name')
            .eq('phone', normalizedPhone)
            .maybeSingle()
          contactName = qc?.name ?? null
        }
        if (!contactName && QUO_MISSED_STATUSES.has(call.status ?? '')) {
          contactName = null // unknown caller
        }

        // AI flagging for new calls with content
        let flagData = { is_flagged: false, flag_reason: null as string | null, tags: [] as string[] }
        const analysisContent = call.summary || call.transcript || ''
        if (analysisContent) {
          const flagResult = await analyzeAndFlag(analysisContent)
          flagData = { is_flagged: flagResult.is_flagged, flag_reason: flagResult.flag_reason, tags: flagResult.tags }
          if (flagResult.is_flagged) results.flagged++
        } else if (!matchedClient && call.direction === 'inbound' && QUO_MISSED_STATUSES.has(call.status ?? '')) {
          // Unknown inbound missed call — always flag
          flagData = { is_flagged: true, flag_reason: 'Unknown caller — missed inbound call', tags: ['unknown-caller', 'missed-opportunity'] }
          results.flagged++
        }

        const { error } = await db.from('quo_calls').insert({
          quo_id: call.id,
          direction: call.direction,
          from_number: call.from,
          to_number: call.to,
          duration_seconds: call.duration ?? null,
          status: call.status ?? null,
          recording_url: call.recording?.url ?? null,
          transcript: call.transcript ?? null,
          ai_summary: call.summary ?? null,
          ai_tags: flagData.tags.length > 0 ? flagData.tags : null,
          contact_name: contactName,
          phone_number_id: call.phoneNumberId ?? null,
          user_id: call.userId ?? null,
          is_flagged: flagData.is_flagged,
          flag_reason: flagData.flag_reason,
          client_id: matchedClient?.id ?? null,
        })

        if (error) console.error('[sync/quo] call insert error:', error)
        else results.calls++
      }
    } while (pageToken && pages < 5)
  } catch (err) {
    console.error('[sync/quo] calls sync error:', err)
    results.errors.push(`Calls: ${String(err)}`)
  }

  // ── Sync messages ──────────────────────────────────────────────────────
  try {
    let pageToken: string | null = null
    let pages = 0
    do {
      const { data: messages, nextPageToken } = await getMessages({
        maxResults: 50,
        pageToken: pageToken ?? undefined,
      })
      pageToken = nextPageToken
      pages++

      for (const msg of messages) {
        const externalPhone = msg.direction === 'inbound' ? msg.from : msg.to
        const normalizedPhone = normalizePhone(externalPhone)
        const matchedClient = phoneToClient.get(normalizedPhone)

        const { data: existing } = await db
          .from('quo_messages')
          .select('id')
          .eq('quo_id', msg.id)
          .maybeSingle()

        if (existing) { results.messages++; continue }

        let contactName: string | null = matchedClient?.name ?? null
        if (!contactName) {
          const { data: qc } = await db
            .from('quo_contacts')
            .select('name')
            .eq('phone', normalizedPhone)
            .maybeSingle()
          contactName = qc?.name ?? null
        }

        // AI flag inbound messages
        let flagData = { is_flagged: false, flag_reason: null as string | null }
        if (msg.direction === 'inbound' && msg.body) {
          const flagResult = await analyzeAndFlag(msg.body)
          flagData = { is_flagged: flagResult.is_flagged, flag_reason: flagResult.flag_reason }
          if (flagResult.is_flagged) results.flagged++
        }

        const { error } = await db.from('quo_messages').insert({
          quo_id: msg.id,
          direction: msg.direction,
          from_number: msg.from,
          to_number: msg.to,
          body: msg.body ?? null,
          contact_name: contactName,
          phone_number_id: msg.phoneNumberId ?? null,
          user_id: msg.userId ?? null,
          is_flagged: flagData.is_flagged,
          flag_reason: flagData.flag_reason,
          client_id: matchedClient?.id ?? null,
        })

        if (error) console.error('[sync/quo] message insert error:', error)
        else results.messages++
      }
    } while (pageToken && pages < 5)
  } catch (err) {
    console.error('[sync/quo] messages sync error:', err)
    results.errors.push(`Messages: ${String(err)}`)
  }

  // ── Timestamp + activity log ──────────────────────────────────────────
  const syncedAt = new Date().toISOString()
  await db.from('app_settings').upsert(
    { key: 'last_quo_sync', value: syncedAt, description: 'Last Quo (OpenPhone) sync' },
    { onConflict: 'key' }
  )

  if (results.flagged > 0) {
    await db.from('activity_feed').insert({
      event_type: 'quo_flagged',
      title: `${results.flagged} communication${results.flagged !== 1 ? 's' : ''} need attention`,
      description: `${results.calls} calls · ${results.messages} messages synced from Quo`,
    })
  }

  return NextResponse.json({ success: true, synced: results, synced_at: syncedAt })
}
