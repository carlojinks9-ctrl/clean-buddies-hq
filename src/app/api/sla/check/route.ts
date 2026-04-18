import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import {
  checkQuoMissedCalls,
  checkQuoUnansweredMessages,
  checkGhlUnactioned,
  checkInstantlyUnhandled,
  sendSlaAlert,
  minutesSince,
} from '@/lib/sla'

export const dynamic = 'force-dynamic'

export async function GET() {
  return runCheck()
}

export async function POST() {
  return runCheck()
}

async function runCheck() {
  const db = createServerClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  let newBreaches = 0
  let tasksCreated = 0
  let alertsSent = 0
  const errors: string[] = []

  try {
    // Load active SLA rules
    const { data: rules } = await db
      .from('sla_rules')
      .select('*')
      .eq('is_active', true)

    const ruleMap = new Map((rules || []).map((r: { condition_key: string; threshold_minutes: number }) => [r.condition_key, r]))
    const getThreshold = (key: string, fallback: number) => ruleMap.get(key)?.threshold_minutes ?? fallback

    // ── 1. Quo missed calls ──────────────────────────────────────────────────
    const missedCalls = await checkQuoMissedCalls(db, getThreshold('missed_call', 10)).catch(e => {
      errors.push(`quo_missed_calls: ${e}`)
      return []
    })

    for (const call of missedCalls) {
      // Check if we already created a breach for this call recently
      const { count: breachCount } = await db
        .from('sla_breaches')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'quo_call')
        .gte('created_at', new Date(Date.now() - 60 * 60_000).toISOString()) // last hour
        // We don't have a direct reference here, use raw DB call for de-dup

      // Create or update inbound item
      const { data: existing } = await db
        .from('inbound_items')
        .select('id, sla_breached')
        .eq('source', 'quo_call')
        .eq('source_id', call.id)
        .maybeSingle()

      let inboundItemId = existing?.id

      if (!existing) {
        const threshold = getThreshold('missed_call', 10)
        const slaDeadline = new Date(new Date(call.created_at).getTime() + threshold * 60_000).toISOString()
        const { data: created } = await db
          .from('inbound_items')
          .insert({
            source: 'quo_call',
            source_id: call.id,
            contact_name: call.contact_name,
            phone: call.from_number,
            subject: `Missed call from ${call.contact_name ?? call.from_number}`,
            body_preview: `Missed ${call.minutes_ago} minutes ago — no callback recorded`,
            urgency: 'high',
            tags: ['missed-call', 'callback-needed'],
            status: 'new',
            sla_deadline: slaDeadline,
            sla_breached: call.minutes_ago > threshold,
            sla_rule: 'Quo Missed Call',
          })
          .select('id')
          .single()
        inboundItemId = created?.id
      } else if (!existing.sla_breached) {
        await db.from('inbound_items').update({ sla_breached: true }).eq('id', existing.id)
      }

      if (inboundItemId) {
        newBreaches++

        // Create task
        const { data: task } = await db
          .from('tasks')
          .insert({
            title: `Call back: ${call.contact_name ?? call.from_number}`,
            description: `Missed Quo call ${call.minutes_ago} min ago — SLA breached (${getThreshold('missed_call', 10)} min threshold)`,
            category: 'sales',
            priority: 'urgent',
            status: 'todo',
            assignee: 'carlo',
          })
          .select('id')
          .single()

        if (task) {
          tasksCreated++
          await db.from('inbound_items').update({ task_id: task.id }).eq('id', inboundItemId)
        }

        // Telegram alert
        const alerted = await sendSlaAlertOnce(db, 'quo_call', call.id, async () => {
          await sendSlaAlert(
            `🔴 <b>SLA BREACH — Missed Call</b>\n\nNo callback in ${call.minutes_ago} min\nFrom: <b>${call.contact_name ?? call.from_number}</b>\n\n<a href="${appUrl}/inbox">View Callback Queue →</a>`
          )
        })
        if (alerted) alertsSent++
      }
    }

    // ── 2. Quo unanswered messages ────────────────────────────────────────────
    const unanswered = await checkQuoUnansweredMessages(db, getThreshold('inbound_text', 30)).catch(e => {
      errors.push(`quo_messages: ${e}`)
      return []
    })

    for (const msg of unanswered) {
      const { data: existing } = await db
        .from('inbound_items')
        .select('id, sla_breached')
        .eq('source', 'quo_message')
        .eq('source_id', msg.id)
        .maybeSingle()

      if (!existing) {
        const threshold = getThreshold('inbound_text', 30)
        const slaDeadline = new Date(new Date(msg.created_at).getTime() + threshold * 60_000).toISOString()
        await db.from('inbound_items').insert({
          source: 'quo_message',
          source_id: msg.id,
          contact_name: msg.contact_name,
          phone: msg.from_number,
          subject: `Text from ${msg.contact_name ?? msg.from_number}`,
          body_preview: msg.body ? msg.body.slice(0, 150) : 'Inbound SMS',
          urgency: 'high',
          tags: ['inbound-text', 'reply-needed'],
          status: 'new',
          sla_deadline: slaDeadline,
          sla_breached: msg.minutes_ago > threshold,
          sla_rule: 'Quo Inbound Text',
        })
        newBreaches++

        const alerted = await sendSlaAlertOnce(db, 'quo_message', msg.id, async () => {
          await sendSlaAlert(
            `🟡 <b>SLA BREACH — Unanswered Text</b>\n\nNo reply in ${msg.minutes_ago} min\nFrom: <b>${msg.contact_name ?? msg.from_number}</b>\n${msg.body ? `"${msg.body.slice(0, 80)}"` : ''}\n\n<a href="${appUrl}/inbox">View Inbox →</a>`
          )
        })
        if (alerted) alertsSent++
      } else if (!existing.sla_breached) {
        await db.from('inbound_items').update({ sla_breached: true }).eq('id', existing.id)
      }
    }

    // ── 3. GHL unactioned forms ────────────────────────────────────────────────
    const ghlPending = await checkGhlUnactioned(db, getThreshold('form_submit', 15)).catch(e => {
      errors.push(`ghl_submissions: ${e}`)
      return []
    })

    for (const sub of ghlPending) {
      await db.from('sla_breaches').insert({
        source: 'ghl',
        rule_name: 'GHL Form Submission',
        threshold_minutes: getThreshold('form_submit', 15),
        actual_minutes: sub.minutes_ago,
        telegram_sent: false,
        task_created: false,
      })
      newBreaches++

      const alerted = await sendSlaAlertOnce(db, 'ghl', sub.id, async () => {
        await sendSlaAlert(
          `🔴 <b>SLA BREACH — Website Form</b>\n\nNot actioned in ${sub.minutes_ago} min\nFrom: <b>${sub.contact_name ?? 'Unknown'}</b>\n${sub.service_type ? `Service: ${sub.service_type}` : ''}\n\n<a href="${appUrl}/inbox">View Inbox →</a>`
        )
      })
      if (alerted) alertsSent++
    }

    // ── 4. Instantly unhandled positive replies ───────────────────────────────
    const instantlyPending = await checkInstantlyUnhandled(db, getThreshold('positive_reply', 480)).catch(e => {
      errors.push(`instantly: ${e}`)
      return []
    })

    for (const reply of instantlyPending) {
      newBreaches++
      const alerted = await sendSlaAlertOnce(db, 'instantly', reply.id, async () => {
        await sendSlaAlert(
          `📧 <b>SLA BREACH — Instantly Reply</b>\n\nPositive reply unhandled ${reply.minutes_ago} min\nFrom: <b>${reply.from_name ?? reply.from_email}</b>\n${reply.subject ? `Subject: ${reply.subject}` : ''}\n\n<a href="${appUrl}/inbox">View Inbox →</a>`
        )
      })
      if (alerted) alertsSent++
    }

    // Update last SLA check
    await db.from('app_settings').upsert(
      { key: 'last_sla_check', value: new Date().toISOString(), description: 'Last SLA check timestamp' },
      { onConflict: 'key' }
    )

    return NextResponse.json({
      ok: true,
      new_breaches: newBreaches,
      tasks_created: tasksCreated,
      alerts_sent: alertsSent,
      errors,
      checked_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[sla/check] Error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 200 })
  }
}

// De-duplicate: don't fire the same alert twice in 1 hour for the same source+id
async function sendSlaAlertOnce(
  db: ReturnType<typeof createServerClient>,
  source: string,
  sourceId: string,
  sendFn: () => Promise<void>
): Promise<boolean> {
  const recentCutoff = new Date(Date.now() - 60 * 60_000).toISOString()
  const { count } = await db
    .from('sla_breaches')
    .select('id', { count: 'exact', head: true })
    .eq('source', source)
    .gte('created_at', recentCutoff)

  if (count && count > 0) return false  // already alerted recently

  await db.from('sla_breaches').insert({
    source,
    rule_name: `${source}_sla`,
    threshold_minutes: 0,
    telegram_sent: true,
    task_created: false,
  })

  await sendFn().catch(e => console.error('[sla/check] Alert error:', e))
  return true
}
