import { createServerClient } from '@/lib/supabase'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { ActiveJobsPanel } from '@/components/dashboard/ActiveJobsPanel'
import { LeadPipelinePanel } from '@/components/dashboard/LeadPipelinePanel'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { SchedulePanel } from '@/components/dashboard/SchedulePanel'
import { GmailWidget } from '@/components/dashboard/GmailWidget'
import { RecentCallsWidget } from '@/components/dashboard/RecentCallsWidget'
import { RevenueChart } from '@/components/charts/RevenueChart'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { MonoValue } from '@/components/ui/MonoValue'
import { DollarSign, TrendingUp, CreditCard, HardHat, PhoneMissed } from 'lucide-react'
import { formatCents, formatMargin, grossMargin } from '@/lib/margin'
import { startOfDay, format } from 'date-fns'
import type { Job, Lead, ActivityFeedItem, Invoice } from '@/types'

async function getDashboardData() {
  try {
    const db = createServerClient()

    const todayStart = startOfDay(new Date()).toISOString()
    // Last 6 months for revenue trend
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const sixMonthsAgoDate = sixMonthsAgo.toISOString().split('T')[0]

    const [jobsRes, leadsRes, activityRes, invoicesRes, employeesRes, missedCallsRes, revenueHistoryRes] = await Promise.all([
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

      db
        .from('employees')
        .select('id, status')
        .eq('status', 'active'),

      db
        .from('quo_calls')
        .select('id', { count: 'exact', head: true })
        .in('status', ['missed', 'no-answer', 'busy', 'voicemail'])
        .gte('created_at', todayStart),

      // Jobs with real Jobber data for revenue trend (excludes pure seed data that has no jobber_id)
      db
        .from('jobs')
        .select('contract_value_cents, start_date, jobber_id')
        .not('start_date', 'is', null)
        .gte('start_date', sixMonthsAgoDate)
        .not('jobber_id', 'is', null),
    ])

    // Compute real monthly revenue chart data from synced jobs
    let revenueChartData: Array<{ month: string; revenue: number }> | undefined
    const revenueJobs = revenueHistoryRes.data || []
    if (revenueJobs.length > 0) {
      const monthMap = new Map<string, number>()
      for (const j of revenueJobs) {
        if (j.start_date) {
          // Format as "Jan", "Feb", etc.
          const monthKey = format(new Date(j.start_date + 'T00:00:00'), 'MMM')
          monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + (j.contract_value_cents || 0))
        }
      }
      if (monthMap.size >= 2) {
        revenueChartData = Array.from(monthMap.entries()).map(([month, revenue]) => ({ month, revenue }))
      }
    }

    return {
      jobs: (jobsRes.data || []) as Job[],
      leads: (leadsRes.data || []) as Lead[],
      activity: (activityRes.data || []) as ActivityFeedItem[],
      invoices: (invoicesRes.data || []) as Invoice[],
      activeCrewCount: (employeesRes.data || []).length,
      missedCallsToday: missedCallsRes.count ?? 0,
      revenueChartData,
    }
  } catch {
    return { jobs: [], leads: [], activity: [], invoices: [], activeCrewCount: 0, missedCallsToday: 0, revenueChartData: undefined }
  }
}

export default async function DashboardPage() {
  const { jobs, leads, activity, invoices, activeCrewCount, missedCallsToday, revenueChartData } = await getDashboardData()

  // Compute KPIs
  const activeJobs = jobs.filter(j => j.status === 'active' || j.status === 'scheduled')
  const monthlyRevenue = jobs.reduce((s, j) => s + j.contract_value_cents, 0)
  const totalLaborCents = jobs.reduce((s, j) => s + j.burdened_labor_cents, 0)
  const blendedMargin = grossMargin(monthlyRevenue, totalLaborCents)
  const outstandingAr = invoices.reduce((s, i) => s + i.balance_cents, 0)
  const activeCrew = activeCrewCount

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Monthly Revenue"
          value={formatCents(monthlyRevenue)}
          subvalue={format(new Date(), 'MMM yyyy')}
          change={13.1}
          icon={<DollarSign className="w-4 h-4 text-brand-green" />}
          iconColor="bg-brand-green/10"
          mono
        />
        <KpiCard
          title="Gross Margin"
          value={formatMargin(blendedMargin)}
          subvalue={`target 65% | floor 50%`}
          change={2.3}
          icon={<TrendingUp className="w-4 h-4 text-accent-blue" />}
          iconColor="bg-accent-blue/10"
          mono
        />
        <KpiCard
          title="Outstanding AR"
          value={formatCents(outstandingAr)}
          subvalue={`${invoices.filter(i => i.status === 'overdue').length} overdue`}
          change={-8.4}
          icon={<CreditCard className="w-4 h-4 text-accent-amber" />}
          iconColor="bg-accent-amber/10"
          mono
        />
        <KpiCard
          title="Active Crews"
          value={String(activeCrew)}
          subvalue={`${activeJobs.length} jobs active / scheduled`}
          icon={<HardHat className="w-4 h-4 text-text-secondary" />}
          iconColor="bg-white/5"
          mono
        />
        {missedCallsToday > 0 && (
          <KpiCard
            title="Missed Calls Today"
            value={String(missedCallsToday)}
            subvalue="needs follow-up"
            icon={<PhoneMissed className="w-4 h-4 text-accent-red" />}
            iconColor="bg-accent-red/10"
            mono
          />
        )}
      </div>

      {/* Revenue Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Trend</CardTitle>
          <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-brand-green inline-block" />
              Actual
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-accent-blue inline-block border-dashed border-t border-accent-blue" style={{background:'none'}} />
              Target
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <RevenueChart data={revenueChartData} />
        </CardContent>
      </Card>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActiveJobsPanel jobs={jobs} />
        <LeadPipelinePanel leads={leads} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SchedulePanel />
        <GmailWidget />
        <ActivityFeed items={activity} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RecentCallsWidget />
      </div>

      {/* AR Alert Banner */}
      {invoices.filter(i => i.status === 'overdue').length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-accent-red/5 border border-accent-red/20">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-red animate-pulse flex-shrink-0" />
          <p className="text-sm text-accent-red font-medium">
            {invoices.filter(i => i.status === 'overdue').length} overdue invoice{invoices.filter(i => i.status === 'overdue').length !== 1 ? 's' : ''} totaling{' '}
            <MonoValue cents={invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.balance_cents, 0)} />
          </p>
          <a href="/financials" className="ml-auto text-[11px] text-accent-red hover:underline">View AR →</a>
        </div>
      )}
    </div>
  )
}
