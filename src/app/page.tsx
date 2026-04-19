export const dynamic = 'force-dynamic'

import { createServerClient } from '@/lib/supabase'
import { ActiveJobsPanel } from '@/components/dashboard/ActiveJobsPanel'
import { LeadPipelinePanel } from '@/components/dashboard/LeadPipelinePanel'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { SchedulePanel } from '@/components/dashboard/SchedulePanel'
import { RevenueChart } from '@/components/charts/RevenueChart'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { MonoValue } from '@/components/ui/MonoValue'
import {
  DollarSign, TrendingUp, CreditCard, AlertTriangle,
  Inbox, CheckSquare, ShoppingCart, PhoneMissed, Briefcase,
  ArrowRight,
} from 'lucide-react'
import { formatCents, formatMargin, grossMargin } from '@/lib/margin'
import { startOfDay, format, parseISO, compareAsc } from 'date-fns'
import Link from 'next/link'
import type { Job, Lead, ActivityFeedItem, Invoice } from '@/types'

async function getDashboardData() {
  try {
    const db = createServerClient()
    const todayStart = startOfDay(new Date()).toISOString()
    const todayDate = todayStart.split('T')[0]

    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const sixMonthsAgoDate = sixMonthsAgo.toISOString().split('T')[0]

    const [
      jobsRes, leadsRes, activityRes, invoicesRes,
      overdueTasksRes, inboxCountRes, suppliesRes,
      missedCallsRes, revenueHistoryRes, invoiceJobsRes,
    ] = await Promise.all([
      db
        .from('jobs')
        .select('*, client:clients(id, name, company_name)')
        .in('status', ['active', 'scheduled', 'completed', 'invoiced', 'issue'])
        .order('updated_at', { ascending: false })
        .limit(20),

      db
        .from('leads')
        .select('*')
        .neq('status', 'lost')
        .order('created_at', { ascending: false })
        .limit(20),

      db
        .from('activity_feed')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20),

      db
        .from('invoices')
        .select('*, client:clients(id, name, company_name)')
        .in('status', ['sent', 'overdue'])
        .order('due_date', { ascending: true }),

      // Overdue tasks
      db
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .lt('due_date', todayDate),

      // Unread inbox items
      db
        .from('inbound_items')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'new'),

      // Pending supply requests
      db
        .from('supply_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),

      // Missed calls today
      db
        .from('quo_calls')
        .select('id', { count: 'exact', head: true })
        .in('status', ['missed', 'no-answer', 'busy', 'voicemail'])
        .gte('created_at', todayStart),

      // Revenue trend
      db
        .from('jobs')
        .select('contract_value_cents, start_date')
        .not('start_date', 'is', null)
        .gte('start_date', sixMonthsAgoDate)
        .not('jobber_id', 'is', null),

      // Jobs needing invoice (completed but not invoiced)
      db
        .from('jobs')
        .select('id, contract_value_cents')
        .eq('status', 'completed'),
    ])

    // Build chronologically-ordered revenue chart
    let revenueChartData: Array<{ month: string; revenue: number }> | undefined
    const revenueJobs = revenueHistoryRes.data || []
    if (revenueJobs.length > 0) {
      // Bucket by YYYY-MM so we can sort correctly
      const monthMap = new Map<string, { label: string; revenue: number }>()
      for (const j of revenueJobs) {
        if (j.start_date) {
          const d = parseISO(j.start_date + 'T00:00:00')
          const key = format(d, 'yyyy-MM')
          const label = format(d, 'MMM')
          const existing = monthMap.get(key)
          monthMap.set(key, {
            label,
            revenue: (existing?.revenue ?? 0) + (j.contract_value_cents || 0),
          })
        }
      }
      if (monthMap.size >= 2) {
        const sorted = Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b))
        revenueChartData = sorted.map(([, v]) => ({ month: v.label, revenue: v.revenue }))
      }
    }

    const invoiceJobs = invoiceJobsRes.data || []
    const invoiceJobCount = invoiceJobs.length
    const invoiceJobValueCents = invoiceJobs.reduce((s, j) => s + (j.contract_value_cents || 0), 0)

    return {
      jobs: (jobsRes.data || []) as Job[],
      leads: (leadsRes.data || []) as Lead[],
      activity: (activityRes.data || []) as ActivityFeedItem[],
      invoices: (invoicesRes.data || []) as Invoice[],
      overdueTaskCount: overdueTasksRes.count ?? 0,
      inboxCount: inboxCountRes.count ?? 0,
      pendingSupplyCount: suppliesRes.count ?? 0,
      missedCallsToday: missedCallsRes.count ?? 0,
      invoiceJobCount,
      invoiceJobValueCents,
      revenueChartData,
    }
  } catch {
    return {
      jobs: [], leads: [], activity: [], invoices: [],
      overdueTaskCount: 0, inboxCount: 0, pendingSupplyCount: 0,
      missedCallsToday: 0, invoiceJobCount: 0, invoiceJobValueCents: 0,
      revenueChartData: undefined,
    }
  }
}

// ─── Action alert card ────────────────────────────────────────────────────────
function ActionCard({
  icon, label, count, sub, href, color,
}: {
  icon: React.ReactNode
  label: string
  count: string | number
  sub?: string
  href: string
  color: 'red' | 'amber' | 'blue' | 'green' | 'gray'
}) {
  const colors = {
    red:   'bg-accent-red/8 border-accent-red/20 hover:border-accent-red/40',
    amber: 'bg-accent-amber/8 border-accent-amber/20 hover:border-accent-amber/40',
    blue:  'bg-brand-blue/8 border-brand-blue/20 hover:border-brand-blue/40',
    green: 'bg-brand-green/8 border-brand-green/20 hover:border-brand-green/40',
    gray:  'bg-bg-elevated border-subtle hover:border-white/10',
  }
  const countColors = {
    red:   'text-accent-red',
    amber: 'text-accent-amber',
    blue:  'text-brand-blue',
    green: 'text-brand-green',
    gray:  'text-text-primary',
  }
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all group ${colors[color]}`}
    >
      <div className="flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className={`font-mono font-bold text-lg leading-none ${countColors[color]}`}>{count}</div>
        <div className="text-[11px] text-text-tertiary mt-0.5 truncate">{label}</div>
        {sub && <div className="text-[10px] text-text-tertiary/70 truncate">{sub}</div>}
      </div>
      <ArrowRight className="w-3.5 h-3.5 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </Link>
  )
}

export default async function DashboardPage() {
  const {
    jobs, leads, activity, invoices,
    overdueTaskCount, inboxCount, pendingSupplyCount, missedCallsToday,
    invoiceJobCount, invoiceJobValueCents,
    revenueChartData,
  } = await getDashboardData()

  const activeJobs = jobs.filter(j => j.status === 'active' || j.status === 'scheduled')
  const overdueInvoices = invoices.filter(i => i.status === 'overdue')
  const overdueAr = overdueInvoices.reduce((s, i) => s + i.balance_cents, 0)
  const totalAr = invoices.reduce((s, i) => s + i.balance_cents, 0)

  // KPIs — only show ones backed by real data
  const totalRevenue = jobs.reduce((s, j) => s + j.contract_value_cents, 0)
  const totalLabor = jobs.reduce((s, j) => s + j.burdened_labor_cents, 0)
  const blendedMargin = grossMargin(totalRevenue, totalLabor)

  // Build action items — only show if count > 0
  const actionItems = [
    overdueInvoices.length > 0 && {
      icon: <CreditCard className="w-4 h-4 text-accent-red" />,
      label: `Overdue invoice${overdueInvoices.length !== 1 ? 's' : ''}`,
      count: overdueInvoices.length,
      sub: formatCents(overdueAr) + ' outstanding',
      href: '/financials',
      color: 'red' as const,
    },
    inboxCount > 0 && {
      icon: <Inbox className="w-4 h-4 text-brand-blue" />,
      label: 'Unread inbox items',
      count: inboxCount,
      href: '/inbox',
      color: 'blue' as const,
    },
    missedCallsToday > 0 && {
      icon: <PhoneMissed className="w-4 h-4 text-accent-red" />,
      label: 'Missed calls today',
      count: missedCallsToday,
      sub: 'needs follow-up',
      href: '/communications',
      color: 'red' as const,
    },
    overdueTaskCount > 0 && {
      icon: <CheckSquare className="w-4 h-4 text-accent-amber" />,
      label: `Overdue task${overdueTaskCount !== 1 ? 's' : ''}`,
      count: overdueTaskCount,
      href: '/tasks',
      color: 'amber' as const,
    },
    invoiceJobCount > 0 && {
      icon: <Briefcase className="w-4 h-4 text-accent-amber" />,
      label: `Job${invoiceJobCount !== 1 ? 's' : ''} to invoice`,
      count: invoiceJobCount,
      sub: formatCents(invoiceJobValueCents) + ' in completed work',
      href: '/jobs',
      color: 'amber' as const,
    },
    pendingSupplyCount > 0 && {
      icon: <ShoppingCart className="w-4 h-4 text-text-secondary" />,
      label: 'Supply requests pending',
      count: pendingSupplyCount,
      href: '/supplies',
      color: 'gray' as const,
    },
  ].filter(Boolean) as Array<{
    icon: React.ReactNode; label: string; count: number; sub?: string; href: string; color: 'red' | 'amber' | 'blue' | 'green' | 'gray'
  }>

  return (
    <div className="space-y-5">

      {/* ── Action Center ──────────────────────────────────────────────────── */}
      {actionItems.length > 0 ? (
        <div>
          <h2 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-2.5">
            Needs Attention
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
            {actionItems.map((item) => (
              <ActionCard key={item.href + item.label} {...item} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-brand-green/5 border border-brand-green/20">
          <span className="w-2 h-2 rounded-full bg-brand-green" />
          <span className="text-sm text-brand-green font-medium">All clear — nothing needs immediate attention</span>
        </div>
      )}

      {/* ── Main work panels ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActiveJobsPanel jobs={jobs} />
        <LeadPipelinePanel leads={leads} />
      </div>

      {/* ── Financials row ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* AR snapshot — only show if there are invoices */}
        {totalAr > 0 && (
          <Link href="/financials" className="block group">
            <Card className="hover:border-white/10 transition-colors h-full">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-3">
                  <CreditCard className="w-4 h-4 text-accent-amber" />
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Outstanding AR</span>
                  <ArrowRight className="w-3 h-3 text-text-tertiary ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="font-mono text-2xl font-bold text-text-primary">{formatCents(totalAr)}</div>
                {overdueAr > 0 && (
                  <div className="mt-1 text-xs text-accent-red font-medium">
                    {formatCents(overdueAr)} overdue
                  </div>
                )}
                <div className="mt-2 text-[11px] text-text-tertiary">
                  {invoices.length} open invoice{invoices.length !== 1 ? 's' : ''}
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        {/* Revenue — only show if there's real data */}
        {totalRevenue > 0 && (
          <Link href="/jobs" className="block group">
            <Card className="hover:border-white/10 transition-colors h-full">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="w-4 h-4 text-brand-blue" />
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Job Revenue</span>
                  <ArrowRight className="w-3 h-3 text-text-tertiary ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="font-mono text-2xl font-bold text-text-primary">{formatCents(totalRevenue)}</div>
                <div className="mt-1 text-[11px] text-text-tertiary">
                  across {jobs.length} job{jobs.length !== 1 ? 's' : ''}
                </div>
                {totalLabor > 0 && (
                  <div className={`mt-2 text-xs font-medium ${blendedMargin >= 0.65 ? 'text-brand-green' : blendedMargin >= 0.5 ? 'text-accent-amber' : 'text-accent-red'}`}>
                    {formatMargin(blendedMargin)} blended margin
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        )}

        {/* Active jobs count */}
        <Link href="/jobs" className="block group">
          <Card className="hover:border-white/10 transition-colors h-full">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-text-secondary" />
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Pipeline</span>
                <ArrowRight className="w-3 h-3 text-text-tertiary ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="font-mono text-2xl font-bold text-text-primary">{activeJobs.length}</div>
              <div className="mt-1 text-[11px] text-text-tertiary">active + scheduled jobs</div>
              <div className="mt-2 text-xs text-text-secondary">
                {leads.filter(l => l.status === 'new').length} new leads in pipeline
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* ── Revenue chart ───────────────────────────────────────────────────── */}
      {revenueChartData && revenueChartData.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Revenue Trend</CardTitle>
            <span className="text-[11px] text-text-tertiary">last 6 months · synced jobs</span>
          </CardHeader>
          <CardContent className="pt-2">
            <RevenueChart data={revenueChartData} />
          </CardContent>
        </Card>
      )}

      {/* ── Schedule + Activity ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SchedulePanel />
        <ActivityFeed items={activity} />
      </div>
    </div>
  )
}
