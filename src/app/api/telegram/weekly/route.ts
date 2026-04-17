/**
 * Weekly summary sent to management Telegram chat.
 * Called from the digest route every Monday, OR directly from here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { subDays, startOfDay, endOfDay, startOfWeek, endOfWeek } from 'date-fns'

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

async function sendMessage(chatId: string, text: string) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  }).catch(err => console.error('[weekly] Telegram send error:', err))
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const mgmtChat = process.env.TELEGRAM_MANAGEMENT_CHAT_ID
  if (!mgmtChat) {
    return NextResponse.json({ error: 'TELEGRAM_MANAGEMENT_CHAT_ID not set' }, { status: 500 })
  }

  const db = createServerClient()
  const now = new Date()

  // Last 7 days (this week) vs 8–14 days ago (previous week)
  const weekStart = subDays(now, 7)
  const prevWeekStart = subDays(now, 14)
  const prevWeekEnd = subDays(now, 7)

  const [
    // This week
    jobsThisWeek,
    leadsThisWeek,
    overdueInvoices,
    activeJobs,
    // Previous week for comparison
    jobsPrevWeek,
    leadsPrevWeek,
    pendingSupplies,
    employees,
  ] = await Promise.all([
    // Jobs completed this week
    db.from('jobs').select('id, title, contract_value_cents, burdened_labor_cents, gross_margin, clients(name)')
      .in('status', ['completed', 'invoiced'])
      .gte('updated_at', weekStart.toISOString()),

    // New leads this week
    db.from('leads').select('id, name, status, estimated_value_cents, service_type')
      .gte('created_at', weekStart.toISOString()),

    // Overdue invoices
    db.from('invoices').select('invoice_number, balance_cents, due_date, clients(name)')
      .eq('status', 'overdue')
      .order('due_date', { ascending: true }),

    // Active/scheduled jobs
    db.from('jobs').select('id, title, gross_margin, contract_value_cents, clients(name)')
      .in('status', ['active', 'scheduled']),

    // Previous week jobs for comparison
    db.from('jobs').select('id, contract_value_cents')
      .in('status', ['completed', 'invoiced'])
      .gte('updated_at', prevWeekStart.toISOString())
      .lt('updated_at', prevWeekEnd.toISOString()),

    db.from('leads').select('id')
      .gte('created_at', prevWeekStart.toISOString())
      .lt('created_at', prevWeekEnd.toISOString()),

    db.from('supply_requests').select('id, item_name, quantity, estimated_cost_cents')
      .eq('status', 'pending'),

    db.from('employees').select('id, name, burdened_rate_cents').eq('status', 'active'),
  ])

  const thisWeekJobs = jobsThisWeek.data ?? []
  const prevWeekJobs = jobsPrevWeek.data ?? []
  const thisWeekLeads = leadsThisWeek.data ?? []
  const prevWeekLeadsCount = (leadsPrevWeek.data ?? []).length
  const overdue = overdueInvoices.data ?? []
  const active = activeJobs.data ?? []
  const supplies = pendingSupplies.data ?? []
  const crew = employees.data ?? []

  // Revenue calculations
  const thisWeekRevenue = thisWeekJobs.reduce((s, j) => s + (j.contract_value_cents || 0), 0)
  const prevWeekRevenue = prevWeekJobs.reduce((s, j) => s + (j.contract_value_cents || 0), 0)
  const revChange = prevWeekRevenue > 0
    ? ((thisWeekRevenue - prevWeekRevenue) / prevWeekRevenue * 100).toFixed(1)
    : null

  // Leads converted (won status this week)
  const leadsWon = thisWeekLeads.filter(l => l.status === 'won').length

  // Total AR
  const totalArCents = overdue.reduce((s, i) => s + (i.balance_cents || 0), 0)

  // Avg labor cost per active job (rough weekly estimate)
  const avgBurdenedRate = crew.length > 0
    ? crew.reduce((s, e) => s + (e.burdened_rate_cents || 0), 0) / crew.length
    : 2310 // fallback $23.10/hr

  // Margin performance by active job
  const marginJobs = active
    .sort((a, b) => (a.gross_margin || 0) - (b.gross_margin || 0))
    .slice(0, 5)

  // Top 3 action items
  const actionItems: string[] = []
  if (overdue.length > 0) {
    actionItems.push(`Chase ${overdue.length} overdue invoice${overdue.length !== 1 ? 's' : ''} totaling ${dollars(totalArCents)}`)
  }
  const lowMarginActive = active.filter(j => (j.gross_margin || 0) < 0.65)
  if (lowMarginActive.length > 0) {
    actionItems.push(`Review pricing on ${lowMarginActive.length} job${lowMarginActive.length !== 1 ? 's' : ''} below 65% margin`)
  }
  const uncontactedLeads = thisWeekLeads.filter(l => l.status === 'new').length
  if (uncontactedLeads > 0) {
    actionItems.push(`Follow up with ${uncontactedLeads} new lead${uncontactedLeads !== 1 ? 's' : ''} from this week`)
  }
  if (supplies.length > 0) {
    const totalSupplyCents = supplies.reduce((s, r) => s + (r.estimated_cost_cents || 0), 0)
    actionItems.push(`Order ${supplies.length} pending supply request${supplies.length !== 1 ? 's' : ''} (~${dollars(totalSupplyCents)})`)
  }
  while (actionItems.length < 3) actionItems.push('Review Dashboard for new activity')

  // Build message
  const weekLabel = new Date(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' – ' + now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  let text = `📊 <b>CB Weekly Report</b>\n<i>${weekLabel}</i>\n\n`

  // Revenue
  text += `💰 <b>Revenue This Week</b>\n`
  text += `${dollars(thisWeekRevenue)}`
  if (revChange !== null) {
    const arrow = Number(revChange) >= 0 ? '▲' : '▼'
    text += ` (${arrow}${Math.abs(Number(revChange))}% vs last week)`
  }
  text += `\n\n`

  // Jobs
  text += `🔧 <b>Jobs (${thisWeekJobs.length} completed · ${active.length} active)</b>\n`
  if (thisWeekJobs.length > 0) {
    thisWeekJobs.slice(0, 4).forEach(j => {
      const marginPct = Math.round((j.gross_margin || 0) * 100)
      const marginColor = marginPct >= 65 ? '✅' : marginPct >= 50 ? '⚠️' : '🔴'
      text += `${marginColor} ${j.title} — ${dollars(j.contract_value_cents || 0)} @ ${marginPct}%\n`
    })
    if (thisWeekJobs.length > 4) text += `+${thisWeekJobs.length - 4} more\n`
  } else {
    text += `No jobs completed this week\n`
  }
  text += `\n`

  // Leads
  text += `🟢 <b>Leads (${thisWeekLeads.length} new · ${leadsWon} converted · ${prevWeekLeadsCount} prev week)</b>\n`
  if (thisWeekLeads.length > 0) {
    thisWeekLeads.slice(0, 3).forEach(l => {
      const val = l.estimated_value_cents ? ` — ~${dollars(l.estimated_value_cents)}` : ''
      text += `• ${l.name}${val} [${l.status}]\n`
    })
  } else {
    text += `No new leads this week\n`
  }
  text += `\n`

  // AR
  text += `💸 <b>AR Aging (${overdue.length} overdue)</b>\n`
  if (overdue.length > 0) {
    const buckets: Record<string, number> = { '0-30d': 0, '31-60d': 0, '60+d': 0 }
    overdue.forEach(inv => {
      const days = Math.floor((now.getTime() - new Date(inv.due_date).getTime()) / 86400000)
      if (days <= 30) buckets['0-30d'] += inv.balance_cents || 0
      else if (days <= 60) buckets['31-60d'] += inv.balance_cents || 0
      else buckets['60+d'] += inv.balance_cents || 0
    })
    Object.entries(buckets).filter(([, v]) => v > 0).forEach(([k, v]) => {
      text += `• ${k}: ${dollars(v)}\n`
    })
    text += `Total: <b>${dollars(totalArCents)}</b>\n`
  } else {
    text += `No overdue invoices ✓\n`
  }
  text += `\n`

  // Crew
  text += `👥 <b>Team (${crew.length} active crew)</b>\n`
  const weeklyLaborEstimate = crew.length * 40 * (avgBurdenedRate / 100) // 40hrs/week estimate
  text += `Estimated weekly labor cost: ~${dollars(Math.round(weeklyLaborEstimate * 100))}\n\n`

  // Margin performance
  if (marginJobs.length > 0) {
    text += `📈 <b>Margin Performance (active jobs)</b>\n`
    marginJobs.forEach(j => {
      const pct = Math.round((j.gross_margin || 0) * 100)
      const icon = pct >= 65 ? '✅' : pct >= 50 ? '⚠️' : '🔴'
      text += `${icon} ${j.title} — ${pct}%\n`
    })
    text += `\n`
  }

  // Action items
  text += `✅ <b>Top Action Items</b>\n`
  actionItems.slice(0, 3).forEach((item, i) => {
    text += `${i + 1}. ${item}\n`
  })

  text += `\n<a href="${process.env.NEXT_PUBLIC_APP_URL || ''}">Open Dashboard →</a>`

  await sendMessage(mgmtChat, text)

  return NextResponse.json({ ok: true, sent_at: now.toISOString() })
}
