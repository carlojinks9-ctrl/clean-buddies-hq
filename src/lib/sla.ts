/**
 * SLA Engine — checks response times against rules and fires alerts
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface SlaRule {
  id: string
  name: string
  source: string
  condition_key: string
  threshold_minutes: number
  urgency_default: 'high' | 'medium' | 'low'
  is_active: boolean
}

export interface SlaCheckResult {
  new_breaches: number
  tasks_created: number
  alerts_sent: number
  errors: string[]
}

/** Minutes elapsed since a timestamp */
export function minutesSince(ts: string): number {
  return Math.floor((Date.now() - new Date(ts).getTime()) / 60_000)
}

/** Is it business hours in Arizona? (7am–9pm MST, no DST) */
export function isBusinessHours(): boolean {
  const aznow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' }))
  const h = aznow.getHours()
  return h >= 7 && h < 21
}

/**
 * Check Quo missed calls that have no callback within threshold.
 * A "callback" is an outbound call to the same number after the missed call.
 */
export async function checkQuoMissedCalls(
  db: SupabaseClient,
  thresholdMinutes: number
): Promise<Array<{ id: string; from_number: string; contact_name: string | null; minutes_ago: number; created_at: string }>> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString()
  const tooRecent = new Date(Date.now() - 2 * 60_000).toISOString() // ignore last 2 min (still completing)

  const { data: missed } = await db
    .from('quo_calls')
    .select('id, from_number, contact_name, created_at')
    .eq('direction', 'inbound')
    .in('status', ['missed', 'no-answer', 'voicemail', 'busy'])
    .lt('created_at', tooRecent)       // at least 2 min old
    .gt('created_at', cutoff)          // within last threshold window (check recent ones)
    .order('created_at', { ascending: false })

  if (!missed?.length) return []

  // For each missed call, check if there's a subsequent outbound call to that number
  const violations = []
  for (const call of missed) {
    const normalizedFrom = call.from_number.replace(/\D/g, '').slice(-10)
    const { count } = await db
      .from('quo_calls')
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'outbound')
      .gte('created_at', call.created_at)  // after the missed call
      .ilike('to_number', `%${normalizedFrom.slice(-7)}%`)

    if (!count || count === 0) {
      violations.push({
        ...call,
        minutes_ago: minutesSince(call.created_at),
      })
    }
  }
  return violations
}

/**
 * Check Quo inbound messages that have no reply within threshold.
 */
export async function checkQuoUnansweredMessages(
  db: SupabaseClient,
  thresholdMinutes: number
): Promise<Array<{ id: string; from_number: string; contact_name: string | null; body: string | null; minutes_ago: number; created_at: string }>> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString()
  const tooRecent = new Date(Date.now() - 2 * 60_000).toISOString()

  const { data: msgs } = await db
    .from('quo_messages')
    .select('id, from_number, contact_name, body, created_at')
    .eq('direction', 'inbound')
    .lt('created_at', tooRecent)
    .gt('created_at', cutoff)
    .order('created_at', { ascending: false })

  if (!msgs?.length) return []

  const violations = []
  for (const msg of msgs) {
    const normalizedFrom = msg.from_number.replace(/\D/g, '').slice(-10)
    const { count } = await db
      .from('quo_messages')
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'outbound')
      .gte('created_at', msg.created_at)
      .ilike('to_number', `%${normalizedFrom.slice(-7)}%`)

    if (!count || count === 0) {
      violations.push({ ...msg, minutes_ago: minutesSince(msg.created_at) })
    }
  }
  return violations
}

/**
 * Check GHL form submissions that haven't been actioned within threshold.
 */
export async function checkGhlUnactioned(
  db: SupabaseClient,
  thresholdMinutes: number
): Promise<Array<{ id: string; contact_name: string | null; service_type: string | null; minutes_ago: number; created_at: string }>> {
  if (!isBusinessHours()) return []  // Only check during business hours

  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString()
  const tooRecent = new Date(Date.now() - 2 * 60_000).toISOString()

  const { data } = await db
    .from('ghl_submissions')
    .select('id, contact_name, service_type, created_at')
    .eq('processed', false)
    .lt('created_at', tooRecent)
    .gt('created_at', cutoff)

  return (data || []).map(r => ({ ...r, minutes_ago: minutesSince(r.created_at) }))
}

/**
 * Check Instantly positive replies not handled within threshold.
 */
export async function checkInstantlyUnhandled(
  db: SupabaseClient,
  thresholdMinutes: number
): Promise<Array<{ id: string; from_name: string | null; from_email: string | null; subject: string | null; minutes_ago: number; received_at: string }>> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString()
  const tooRecent = new Date(Date.now() - 5 * 60_000).toISOString()

  const { data } = await db
    .from('instantly_replies')
    .select('id, from_name, from_email, subject, received_at')
    .eq('sentiment', 'positive')
    .eq('processed', false)
    .lt('received_at', tooRecent)
    .gt('received_at', cutoff)

  return (data || []).map(r => ({ ...r, minutes_ago: minutesSince(r.received_at) }))
}

/**
 * Send a Telegram alert for an SLA breach.
 */
export async function sendSlaAlert(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_MANAGEMENT_CHAT_ID
  if (!token || !chatId) return

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  }).catch(e => console.error('[sla] Telegram alert error:', e))
}

/**
 * Create a task for an SLA breach.
 */
export async function createSlaTask(
  db: SupabaseClient,
  params: {
    title: string
    description: string
    priority: 'urgent' | 'high'
    lead_id?: string
  }
): Promise<string | null> {
  const { data } = await db
    .from('tasks')
    .insert({
      title: params.title,
      description: params.description,
      category: 'sales',
      priority: params.priority,
      status: 'todo',
      assignee: 'carlo',
      job_id: params.lead_id ?? null,
    })
    .select('id')
    .single()
  return data?.id ?? null
}
