/**
 * Combined daily routine — runs at 7am AZ (0 14 * * * UTC)
 *
 * Does three things in one cron invocation (Hobby plan: 2 crons max):
 * 1. Sends Telegram daily digest to management chat
 * 2. Runs smart notification checks (tasks, invoices, leads, jobs, supplies)
 * 3. If today is Monday, sends the weekly summary report
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { sendDailyDigest } from '@/lib/telegram'
import { dispatch, dispatchMany, type NotificationInput } from '@/lib/notifications'
import { subDays, startOfDay, endOfDay, addDays } from 'date-fns'

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServerClient()
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const todayStart = startOfDay(now).toISOString()
  const todayEnd = endOfDay(now).toISOString()
  const yesterdayStart = startOfDay(subDays(now, 1)).toISOString()
  const yesterdayEnd = endOfDay(subDays(now, 1)).toISOString()
  const tomorrowStr = addDays(now, 1).toISOString().slice(0, 10)
  const yesterday = subDays(now, 1).toISOString()
  const twoDaysAgo = subDays(now, 2).toISOString()
  const threeDaysAgo = subDays(now, 3).toISOString()

  // ── 1. GATHER DATA FOR DIGEST ─────────────────────────────────────────────

  const [
    jobsRes,
    suppliesRes,
    invoicesRes,
    leadsRes,
    callsTodayRes,
    missedTodayRes,
    msgsTodayRes,
    flaggedCallRes,
  ] = await Promise.all([
    db.from('jobs').select('title, status, clients(name)').in('status', ['active', 'scheduled']),
    db.from('supply_requests').select('item_name, quantity, job_name').eq('status', 'pending').order('created_at', { ascending: false }),
    db.from('invoices').select('invoice_number, balance_cents, due_date, clients(name)').eq('status', 'overdue').order('due_date', { ascending: true }),
    db.from('leads').select('name, service_type').gte('created_at', yesterdayStart).lte('created_at', yesterdayEnd),
    db.from('quo_calls').select('id', { count: 'exact', head: true }).gte('created_at', todayStart).lte('created_at', todayEnd),
    db.from('quo_calls').select('id', { count: 'exact', head: true }).in('status', ['missed', 'no-answer', 'busy', 'voicemail']).gte('created_at', todayStart).lte('created_at', todayEnd),
    db.from('quo_messages').select('id', { count: 'exact', head: true }).gte('created_at', todayStart).lte('created_at', todayEnd),
    db.from('quo_calls').select('flag_reason').eq('is_flagged', true).order('created_at', { ascending: false }).limit(1),
  ])

  // Tasks due today for digest
  const { data: tasksDueToday } = await db
    .from('tasks').select('title, assignee, status')
    .eq('due_date', todayStr).neq('status', 'done')

  // Tasks overdue for digest
  const { data: overdueTasksAll } = await db
    .from('tasks').select('title, assignee, due_date')
    .neq('status', 'done').lt('due_date', todayStr).not('due_date', 'is', null)

  // Jobs starting today for digest
  const { data: jobsStartingToday } = await db
    .from('jobs').select('title, clients(name)')
    .eq('start_date', todayStr).in('status', ['scheduled', 'active'])

  // Quo flagged items from last 24h
  const { data: quoFlagged24h } = await db
    .from('quo_calls').select('contact_name, flag_reason, from_number, direction')
    .eq('is_flagged', true).gte('created_at', yesterdayStart).lte('created_at', todayEnd)
    .limit(5)

  // Low margin jobs
  const { data: lowMarginJobs } = await db
    .from('jobs').select('title, gross_margin')
    .in('status', ['active', 'scheduled']).lt('gross_margin', 0.65)

  // Total flagged count
  const [flaggedCallsRes, flaggedMsgsRes] = await Promise.all([
    db.from('quo_calls').select('id', { count: 'exact', head: true }).eq('is_flagged', true),
    db.from('quo_messages').select('id', { count: 'exact', head: true }).eq('is_flagged', true),
  ])

  const communications = {
    calls_today: callsTodayRes.count ?? 0,
    missed_calls: missedTodayRes.count ?? 0,
    messages_today: msgsTodayRes.count ?? 0,
    flagged_count: (flaggedCallsRes.count ?? 0) + (flaggedMsgsRes.count ?? 0),
    top_flag: (flaggedCallRes.data?.[0] as any)?.flag_reason ?? null,
  }

  // ── 2. SEND TELEGRAM DIGEST ───────────────────────────────────────────────

  const jobs_active = (jobsRes.data || []).map((j: any) => ({ title: j.title, client: j.clients?.name || '' }))
  const pending_supplies = (suppliesRes.data || []).map((s: any) => ({ item_name: s.item_name, quantity: s.quantity, job_name: s.job_name }))
  const overdue_invoices = (invoicesRes.data || []).map((inv: any) => {
    const due = new Date(inv.due_date)
    return {
      invoice_number: inv.invoice_number,
      client: inv.clients?.name || 'Unknown',
      balance_cents: inv.balance_cents || 0,
      days_overdue: Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86400000)),
    }
  })
  const new_leads = (leadsRes.data || []).map((l: any) => ({ name: l.name, service_type: l.service_type }))

  // Build the enhanced digest by sending augmented data
  await sendEnhancedDigest({
    jobs_active,
    pending_supplies,
    overdue_invoices,
    new_leads,
    communications,
    tasks_due_today: (tasksDueToday || []).map((t: any) => ({ title: t.title, assignee: t.assignee })),
    overdue_tasks_count: (overdueTasksAll || []).length,
    jobs_starting_today: (jobsStartingToday || []).map((j: any) => ({ title: j.title, client: j.clients?.name || '' })),
    quo_flagged_24h: (quoFlagged24h || []).map((c: any) => ({
      name: c.contact_name || c.from_number,
      reason: c.flag_reason,
    })),
    low_margin_jobs: (lowMarginJobs || []).map((j: any) => ({
      title: j.title,
      margin_pct: Math.round((j.gross_margin || 0) * 100),
    })),
  })

  // ── 3. SMART NOTIFICATION CHECKS ─────────────────────────────────────────

  const notifications: NotificationInput[] = []

  // Tasks due today
  for (const task of tasksDueToday ?? []) {
    notifications.push({
      type: 'task_due_today',
      title: '⚡ Task due today',
      message: task.title,
      priority: 'urgent',
      recipient: (task.assignee as any) || 'both',
      link_to: '/tasks',
    })
  }

  // Overdue tasks (summary if many)
  if (overdueTasksAll && overdueTasksAll.length > 0) {
    notifications.push({
      type: 'tasks_overdue',
      title: `${overdueTasksAll.length} overdue task${overdueTasksAll.length !== 1 ? 's' : ''}`,
      message: overdueTasksAll.slice(0, 3).map((t: any) => `• ${t.title}`).join('\n'),
      priority: 'high',
      recipient: 'both',
      link_to: '/tasks',
    })
  }

  // Overdue invoices 30+ days
  const overdueInvoices30 = overdue_invoices.filter(i => i.days_overdue >= 30)
  for (const inv of overdueInvoices30) {
    const dollars = (inv.balance_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    notifications.push({
      type: 'invoice_overdue_30',
      title: `Invoice ${inv.invoice_number} — ${inv.days_overdue}d overdue`,
      message: `${inv.client} owes ${dollars}`,
      priority: 'high',
      recipient: 'carlo',
      link_to: '/financials',
    })
  }

  // Jobs starting tomorrow
  const { data: jobsTomorrow } = await db
    .from('jobs').select('id, title, clients(name)')
    .eq('start_date', tomorrowStr).in('status', ['scheduled', 'active'])
  for (const job of jobsTomorrow ?? []) {
    notifications.push({
      type: 'job_starting_tomorrow',
      title: `Job tomorrow: ${job.title}`,
      message: `Confirm crew assignment and supplies`,
      priority: 'medium',
      recipient: 'jorden',
      link_to: `/jobs/${job.id}`,
    })
  }

  // Margin below floor
  const { data: lowMarginFloor } = await db
    .from('jobs').select('id, title, gross_margin')
    .in('status', ['active', 'scheduled']).lt('gross_margin', 0.50)
  for (const job of lowMarginFloor ?? []) {
    const pct = Math.round((job.gross_margin || 0) * 100)
    notifications.push({
      type: 'job_margin_below_floor',
      title: `🔴 Margin below 50%: ${job.title}`,
      message: `Current margin: ${pct}% — review pricing immediately`,
      priority: 'urgent',
      recipient: 'both',
      link_to: `/jobs/${job.id}`,
    })
  }

  // Leads untouched 24h
  const { data: leads24h } = await db
    .from('leads').select('id, name, service_type')
    .eq('status', 'new').lt('created_at', yesterday).gt('created_at', twoDaysAgo)
  for (const lead of leads24h ?? []) {
    notifications.push({
      type: 'lead_untouched_24h',
      title: `Lead untouched 24h: ${lead.name}`,
      message: `${lead.service_type || 'Unspecified service'} — reach out today`,
      priority: 'medium',
      recipient: 'carlo',
      link_to: '/clients',
    })
  }

  // Leads untouched 48h
  const { data: leads48h } = await db
    .from('leads').select('id, name, service_type')
    .eq('status', 'new').lt('created_at', twoDaysAgo)
  for (const lead of leads48h ?? []) {
    notifications.push({
      type: 'lead_untouched_48h',
      title: `⚠️ Lead cold 48h+: ${lead.name}`,
      message: `Still uncontacted after 48+ hours`,
      priority: 'high',
      recipient: 'both',
      link_to: '/clients',
    })
  }

  // Supply requests pending 3+ days
  const { data: oldSupplies } = await db
    .from('supply_requests').select('id, item_name, quantity, job_name')
    .eq('status', 'pending').lt('created_at', threeDaysAgo)
  if (oldSupplies && oldSupplies.length > 0) {
    notifications.push({
      type: 'supplies_pending_3d',
      title: `${oldSupplies.length} supply request${oldSupplies.length !== 1 ? 's' : ''} pending 3+ days`,
      message: oldSupplies.slice(0, 3).map((s: any) => `• ${s.quantity}x ${s.item_name}`).join('\n'),
      priority: 'medium',
      recipient: 'jorden',
      link_to: '/supplies',
    })
  }

  // Flagged Quo calls from last 24h — notify Carlo
  if (quoFlagged24h && quoFlagged24h.length > 0) {
    for (const call of quoFlagged24h) {
      notifications.push({
        type: 'quo_flagged_call',
        title: `Flagged call: ${(call as any).contact_name || (call as any).from_number}`,
        message: (call as any).flag_reason || 'Call flagged for review',
        priority: 'high',
        recipient: 'carlo',
        link_to: '/communications',
      })
    }
  }

  await dispatchMany(notifications)

  // ── 4. MONDAY: SEND WEEKLY REPORT ────────────────────────────────────────

  const dayOfWeek = now.getDay() // 0=Sun, 1=Mon
  if (dayOfWeek === 1) {
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/telegram/weekly`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
          },
        }
      )
    } catch (err) {
      console.error('[digest] Weekly report trigger failed:', err)
    }
  }

  return NextResponse.json({
    ok: true,
    sent_at: now.toISOString(),
    notifications_fired: notifications.length,
    weekly_report_sent: dayOfWeek === 1,
    counts: {
      jobs: jobs_active.length,
      supplies: pending_supplies.length,
      invoices: overdue_invoices.length,
      leads: new_leads.length,
      calls_today: communications.calls_today,
      missed_calls: communications.missed_calls,
      flagged: communications.flagged_count,
    },
  })
}

// ── Enhanced digest with extra context ───────────────────────────────────────

async function sendEnhancedDigest(data: {
  jobs_active: Array<{ title: string; client: string }>
  pending_supplies: Array<{ item_name: string; quantity: number; job_name: string | null }>
  overdue_invoices: Array<{ invoice_number: string; client: string; balance_cents: number; days_overdue: number }>
  new_leads: Array<{ name: string; service_type: string | null }>
  communications: { calls_today: number; missed_calls: number; messages_today: number; flagged_count: number; top_flag: string | null }
  tasks_due_today: Array<{ title: string; assignee: string | null }>
  overdue_tasks_count: number
  jobs_starting_today: Array<{ title: string; client: string }>
  quo_flagged_24h: Array<{ name: string; reason: string | null }>
  low_margin_jobs: Array<{ title: string; margin_pct: number }>
}) {
  const mgmtChat = process.env.TELEGRAM_MANAGEMENT_CHAT_ID
  if (!mgmtChat || !process.env.TELEGRAM_BOT_TOKEN) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  let text = `🌅 <b>Good Morning — CB Daily Digest</b>\n<i>${today}</i>\n\n`

  // Tasks
  text += `✅ <b>Tasks Due Today (${data.tasks_due_today.length})</b>\n`
  if (data.tasks_due_today.length === 0) {
    text += `No tasks due today\n`
  } else {
    data.tasks_due_today.forEach(t => {
      text += `• ${t.title}${t.assignee ? ` [${t.assignee}]` : ''}\n`
    })
  }
  if (data.overdue_tasks_count > 0) {
    text += `⚠️ ${data.overdue_tasks_count} overdue task${data.overdue_tasks_count !== 1 ? 's' : ''}\n`
  }
  text += `\n`

  // Today's jobs
  text += `📋 <b>Active Jobs (${data.jobs_active.length})</b>\n`
  if (data.jobs_starting_today.length > 0) {
    data.jobs_starting_today.forEach(j => { text += `🆕 Starting today: ${j.title}${j.client ? ` — ${j.client}` : ''}\n` })
  }
  data.jobs_active.slice(0, 5).forEach(j => { text += `• ${j.title}${j.client ? ` — ${j.client}` : ''}\n` })
  if (data.jobs_active.length > 5) text += `• ...and ${data.jobs_active.length - 5} more\n`
  text += `\n`

  // Low margin warning
  if (data.low_margin_jobs.length > 0) {
    text += `⚠️ <b>Low Margin Jobs</b>\n`
    data.low_margin_jobs.forEach(j => {
      const icon = j.margin_pct < 50 ? '🔴' : '🟡'
      text += `${icon} ${j.title} — ${j.margin_pct}%\n`
    })
    text += `\n`
  }

  // Overdue invoices
  text += `💸 <b>Overdue Invoices (${data.overdue_invoices.length})</b>\n`
  if (data.overdue_invoices.length === 0) {
    text += `No overdue invoices ✓\n`
  } else {
    let totalCents = 0
    data.overdue_invoices.slice(0, 5).forEach(inv => {
      totalCents += inv.balance_cents
      const dollars = (inv.balance_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      text += `• #${inv.invoice_number} ${inv.client} — ${dollars} (${inv.days_overdue}d)\n`
    })
    const total = (totalCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    text += `Total AR: <b>${total}</b>\n`
  }
  text += `\n`

  // New leads
  text += `🟢 <b>New Leads Yesterday (${data.new_leads.length})</b>\n`
  if (data.new_leads.length === 0) {
    text += `No new leads\n`
  } else {
    data.new_leads.forEach(l => { text += `• ${l.name}${l.service_type ? ` — ${l.service_type}` : ''}\n` })
  }
  text += `\n`

  // Supplies
  text += `🛒 <b>Pending Supplies (${data.pending_supplies.length})</b>\n`
  if (data.pending_supplies.length === 0) {
    text += `No pending requests\n`
  } else {
    data.pending_supplies.slice(0, 4).forEach(s => {
      text += `• ${s.quantity}x ${s.item_name}${s.job_name ? ` (${s.job_name})` : ''}\n`
    })
    if (data.pending_supplies.length > 4) text += `• ...and ${data.pending_supplies.length - 4} more\n`
  }
  text += `\n`

  // Communications
  text += `📞 <b>Communications</b>\n`
  text += `• ${data.communications.calls_today} call${data.communications.calls_today !== 1 ? 's' : ''}`
  if (data.communications.missed_calls > 0) text += ` (${data.communications.missed_calls} missed ⚠️)`
  text += `\n`
  text += `• ${data.communications.messages_today} message${data.communications.messages_today !== 1 ? 's' : ''}\n`
  if (data.communications.flagged_count > 0) {
    text += `• 🚨 <b>${data.communications.flagged_count} flagged</b>\n`
  }

  // Flagged calls from last 24h
  if (data.quo_flagged_24h.length > 0) {
    text += `\n🚨 <b>Flagged Communications (24h)</b>\n`
    data.quo_flagged_24h.slice(0, 3).forEach(c => {
      text += `• ${c.name}${c.reason ? `: ${c.reason}` : ''}\n`
    })
  }

  text += `\n<a href="${appUrl}">Open Dashboard →</a>`

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: mgmtChat,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  }).catch(err => console.error('[digest] Telegram send error:', err))
}
