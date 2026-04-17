import { createServerClient } from '@/lib/supabase'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { ActiveJobsPanel } from '@/components/dashboard/ActiveJobsPanel'
import { LeadPipelinePanel } from '@/components/dashboard/LeadPipelinePanel'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { SchedulePanel } from '@/components/dashboard/SchedulePanel'
import { GmailWidget } from '@/components/dashboard/GmailWidget'
import { RevenueChart } from '@/components/charts/RevenueChart'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { MonoValue } from '@/components/ui/MonoValue'
import { DollarSign, TrendingUp, CreditCard, HardHat } from 'lucide-react'
import { formatCents, formatMargin, grossMargin } from '@/lib/margin'
import type { Job, Lead, ActivityFeedItem, Invoice } from '@/types'

async function getDashboardData() {
  try {
    const db = createServerClient()

    const [jobsRes, leadsRes, activityRes, invoicesRes, employeesRes] = await Promise.all([
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
    ])

    return {
      jobs: (jobsRes.data || []) as Job[],
      leads: (leadsRes.data || []) as Lead[],
      activity: (activityRes.data || []) as ActivityFeedItem[],
      invoices: (invoicesRes.data || []) as Invoice[],
      activeCrewCount: (employeesRes.data || []).length,
    }
  } catch {
    return { jobs: [], leads: [], activity: [], invoices: [], activeCrewCount: 0 }
  }
}

export default async function DashboardPage() {
  const { jobs, leads, activity, invoices, activeCrewCount } = await getDashboardData()

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
          subvalue="Apr 2026"
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
          <RevenueChart />
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
