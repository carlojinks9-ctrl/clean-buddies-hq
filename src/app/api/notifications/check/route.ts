/**
 * Smart daily notification checks — runs at 7am AZ (0 14 * * * UTC)
 * Combined with the Telegram digest in vercel.json to stay within Hobby cron limits.
 *
 * Checks:
 * - Tasks due today or overdue
 * - Invoices past due
 * - Leads untouched 24h/48h
 * - Jobs starting tomorrow or with margin issues
 * - Supply requests pending 3+ days
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { dispatch, dispatchMany, isQuietHours, type NotificationInput } from '@/lib/notifications'
import { subDays, addDays, startOfDay, endOfDay } from 'date-fns'

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (isQuietHours()) {
    return NextResponse.json({ ok: true, skipped: 'quiet hours' })
  }

  const db = createServerClient()
  const now = new Date()
  const todayStart = startOfDay(now).toISOString()
  const todayEnd = endOfDay(now).toISOString()
  const tomorrowStart = startOfDay(addDays(now, 1)).toISOString()
  const tomorrowEnd = endOfDay(addDays(now, 1)).toISOString()
  const yesterday = subDays(now, 1).toISOString()
  const twoDaysAgo = subDays(now, 2).toISOString()
  const threeDaysAgo = subDays(now, 3).toISOString()

  const notifications: NotificationInput[] = []
  const counts = {
    tasks: 0, invoices: 0, leads: 0, jobs: 0, supplies: 0,
  }

  // ── TASKS ────────────────────────────────────────────────────────────────

  // Tasks due TODAY
  const { data: tasksDueToday } = await db
    .from('tasks')
    .select('id, title, assignee')
    .neq('status', 'done')
    .gte('due_date', now.toISOString().slice(0, 10))
    .lte('due_date', now.toISOString().slice(0, 10))

  for (const task of tasksDueToday ?? []) {
    notifications.push({
      type: 'task_due_today',
      title: '⚡ Task due today',
      message: task.title,
      priority: 'urgent',
      recipient: (task.assignee as any) || 'both',
      link_to: '/tasks',
      metadata: { task_id: task.id },
    })
    counts.tasks++
  }

  // Overdue tasks
  const { data: overdueTasks } = await db
    .from('tasks')
    .select('id, title, assignee, due_date')
    .neq('status', 'done')
    .lt('due_date', now.toISOString().slice(0, 10))
    .not('due_date', 'is', null)

  if (overdueTasks && overdueTasks.length > 0) {
    notifications.push({
      type: 'tasks_overdue',
      title: `${overdueTasks.length} overdue task${overdueTasks.length !== 1 ? 's' : ''}`,
      message: overdueTasks.slice(0, 3).map(t => `• ${t.title}`).join('\n'),
      priority: 'high',
      recipient: 'both',
      link_to: '/tasks',
    })
    counts.tasks += overdueTasks.length
  }

  // ── INVOICES ─────────────────────────────────────────────────────────────

  // Invoices overdue 30+ days
  const { data: overdueInvoices30 } = await db
    .from('invoices')
    .select('id, invoice_number, balance_cents, due_date, clients(name)')
    .eq('status', 'overdue')
    .lt('due_date', subDays(now, 30).toISOString().slice(0, 10))

  for (const inv of overdueInvoices30 ?? []) {
    const client = (inv.clients as any)?.name ?? 'Unknown'
    const dollars = ((inv.balance_cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    const daysOver = Math.floor((now.getTime() - new Date(inv.due_date).getTime()) / 86400000)
    notifications.push({
      type: 'invoice_overdue_30',
      title: `Invoice ${inv.invoice_number} — ${daysOver}d overdue`,
      message: `${client} owes ${dollars} — ${daysOver} days past due`,
      priority: 'high',
      recipient: 'carlo',
      link_to: '/financials',
      metadata: { invoice_id: inv.id },
    })
    counts.invoices++
  }

  // Total AR > $20K warning
  const { data: allOverdue } = await db
    .from('invoices')
    .select('balance_cents')
    .eq('status', 'overdue')

  const totalArCents = (allOverdue ?? []).reduce((s, i) => s + (i.balance_cents || 0), 0)
  if (totalArCents > 2_000_000) { // $20,000
    const dollars = (totalArCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    notifications.push({
      type: 'ar_high',
      title: `AR exceeds $20K`,
      message: `Total outstanding AR is ${dollars}. Review aging report.`,
      priority: 'high',
      recipient: 'carlo',
      link_to: '/financials',
    })
  }

  // ── LEADS ────────────────────────────────────────────────────────────────

  // Leads untouched 24h (not yet contacted)
  const { data: leads24h } = await db
    .from('leads')
    .select('id, name, service_type')
    .eq('status', 'new')
    .lt('created_at', yesterday)
    .gt('created_at', twoDaysAgo)

  for (const lead of leads24h ?? []) {
    notifications.push({
      type: 'lead_untouched_24h',
      title: `Lead untouched 24h: ${lead.name}`,
      message: `${lead.service_type || 'Unspecified service'} — hasn't been contacted yet`,
      priority: 'medium',
      recipient: 'carlo',
      link_to: '/clients',
      metadata: { lead_id: lead.id },
    })
    counts.leads++
  }

  // Leads untouched 48h — escalate
  const { data: leads48h } = await db
    .from('leads')
    .select('id, name, service_type')
    .eq('status', 'new')
    .lt('created_at', twoDaysAgo)

  for (const lead of leads48h ?? []) {
    notifications.push({
      type: 'lead_untouched_48h',
      title: `⚠️ Lead cold for 48h: ${lead.name}`,
      message: `${lead.service_type || 'Lead'} still uncontacted after 48 hours`,
      priority: 'high',
      recipient: 'both',
      link_to: '/clients',
      metadata: { lead_id: lead.id },
    })
    counts.leads++
  }

  // ── JOBS ─────────────────────────────────────────────────────────────────

  // Jobs starting tomorrow
  const { data: jobsTomorrow } = await db
    .from('jobs')
    .select('id, title, clients(name)')
    .gte('start_date', tomorrowStart.slice(0, 10))
    .lte('start_date', tomorrowEnd.slice(0, 10))
    .in('status', ['scheduled', 'active'])

  for (const job of jobsTomorrow ?? []) {
    const client = (job.clients as any)?.name ?? ''
    notifications.push({
      type: 'job_starting_tomorrow',
      title: `Job tomorrow: ${job.title}`,
      message: `${client ? client + ' — ' : ''}Confirm crew assignment and supplies`,
      priority: 'medium',
      recipient: 'jorden',
      link_to: `/jobs/${job.id}`,
      metadata: { job_id: job.id },
    })
    counts.jobs++
  }

  // Jobs below margin floor (50%)
  const { data: lowMarginJobs } = await db
    .from('jobs')
    .select('id, title, gross_margin, clients(name)')
    .in('status', ['active', 'scheduled'])
    .lt('gross_margin', 0.50)

  for (const job of lowMarginJobs ?? []) {
    const marginPct = Math.round((job.gross_margin || 0) * 100)
    notifications.push({
      type: 'job_margin_below_floor',
      title: `🔴 Margin below 50%: ${job.title}`,
      message: `Current margin: ${marginPct}% — below minimum threshold. Review pricing.`,
      priority: 'urgent',
      recipient: 'both',
      link_to: `/jobs/${job.id}`,
      metadata: { job_id: job.id, gross_margin: job.gross_margin },
    })
    counts.jobs++
  }

  // Jobs between 50-65% (amber warning)
  const { data: amberMarginJobs } = await db
    .from('jobs')
    .select('id, title, gross_margin')
    .in('status', ['active', 'scheduled'])
    .gte('gross_margin', 0.50)
    .lt('gross_margin', 0.65)

  for (const job of amberMarginJobs ?? []) {
    const marginPct = Math.round((job.gross_margin || 0) * 100)
    notifications.push({
      type: 'job_margin_below_target',
      title: `Margin below target: ${job.title}`,
      message: `Current margin: ${marginPct}% — below 65% target`,
      priority: 'medium',
      recipient: 'carlo',
      link_to: `/jobs/${job.id}`,
      metadata: { job_id: job.id },
    })
  }

  // ── SUPPLIES ─────────────────────────────────────────────────────────────

  // Supply requests pending 3+ days
  const { data: oldSupplies } = await db
    .from('supply_requests')
    .select('id, item_name, quantity, job_name')
    .eq('status', 'pending')
    .lt('created_at', threeDaysAgo)

  if (oldSupplies && oldSupplies.length > 0) {
    notifications.push({
      type: 'supplies_pending_3d',
      title: `${oldSupplies.length} supply request${oldSupplies.length !== 1 ? 's' : ''} pending 3+ days`,
      message: oldSupplies.slice(0, 3).map(s => `• ${s.quantity}x ${s.item_name}${s.job_name ? ` (${s.job_name})` : ''}`).join('\n'),
      priority: 'medium',
      recipient: 'jorden',
      link_to: '/supplies',
    })
    counts.supplies += oldSupplies.length
  }

  // Dispatch all
  await dispatchMany(notifications)

  return NextResponse.json({
    ok: true,
    fired: notifications.length,
    counts,
    checked_at: now.toISOString(),
  })
}
