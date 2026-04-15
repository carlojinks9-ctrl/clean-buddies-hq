import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { StatusDot } from '@/components/ui/StatusDot'
import { MarginBadge } from '@/components/ui/MarginBadge'
import { MonoValue } from '@/components/ui/MonoValue'
import { Badge } from '@/components/ui/Badge'
import { ArrowLeft, Clock, DollarSign, TrendingUp, AlertTriangle } from 'lucide-react'
import { formatCents, grossMargin, formatMargin, marginColor, priceForMargin } from '@/lib/margin'
import { format } from 'date-fns'
import type { Job, Client } from '@/types'

async function getJob(id: string) {
  try {
    const db = createServerClient()
    const { data } = await db
      .from('jobs')
      .select('*, client:clients(*)')
      .eq('id', id)
      .single()
    return data as (Job & { client: Client }) | null
  } catch {
    return null
  }
}

export default async function JobDetailPage({ params }: { params: { id: string } }) {
  const job = await getJob(params.id)
  if (!job) notFound()

  const margin = job.gross_margin
  const mColor = marginColor(margin)
  const revenue = job.contract_value_cents
  const labor = job.burdened_labor_cents
  const profit = revenue - labor
  const targetRevenue = priceForMargin(labor, 0.65)
  const floorRevenue = priceForMargin(labor, 0.50)
  const variance = revenue - targetRevenue

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Breadcrumb */}
      <Link href="/jobs" className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors">
        <ArrowLeft className="w-3 h-3" />
        Back to Jobs
      </Link>

      {/* Job Header */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <StatusDot status={job.status as any} pulse={job.status === 'active'} />
              <h1 className="text-xl font-bold text-text-primary">{job.title}</h1>
            </div>
            <p className="text-sm text-text-secondary">
              {job.client?.company_name || job.client?.name} · {job.job_number}
            </p>
            {job.start_date && (
              <p className="text-[11px] text-text-tertiary font-mono mt-1">
                {format(new Date(job.start_date), 'MMM d')}
                {job.end_date && ` — ${format(new Date(job.end_date), 'MMM d, yyyy')}`}
              </p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <MonoValue cents={revenue} size="2xl" />
            <div className="mt-1">
              <MarginBadge margin={margin} />
            </div>
          </div>
        </div>

        {job.notes && (
          <div className="mt-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <p className="text-xs text-text-secondary">{job.notes}</p>
          </div>
        )}

        {margin < 0.50 ? (
          <div className="mt-4 flex items-center gap-2 p-3 rounded-lg bg-accent-red/5 border border-accent-red/20">
            <AlertTriangle className="w-4 h-4 text-accent-red flex-shrink-0" />
            <p className="text-sm text-accent-red">
              Margin below floor ({formatMargin(0.50)}). Revenue needs to be at least{' '}
              <span className="font-mono font-semibold">{formatCents(floorRevenue)}</span> to meet floor.
            </p>
          </div>
        ) : null}
      </div>

      {/* Cost Breakdown */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-3.5 h-3.5 text-brand-green" />
            <span className="text-[11px] text-text-tertiary uppercase tracking-wider">Contract Value</span>
          </div>
          <MonoValue cents={revenue} size="lg" />
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-accent-amber" />
            <span className="text-[11px] text-text-tertiary uppercase tracking-wider">Burdened Labor</span>
          </div>
          <MonoValue cents={labor} size="lg" />
          <p className="text-[11px] text-text-tertiary mt-0.5 font-mono">
            {job.total_hours.toFixed(1)}h @ $23.10/hr
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-accent-blue" />
            <span className="text-[11px] text-text-tertiary uppercase tracking-wider">Gross Profit</span>
          </div>
          <MonoValue
            cents={profit}
            size="lg"
            color={profit >= 0 ? 'text-brand-green' : 'text-accent-red'}
          />
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] text-text-tertiary uppercase tracking-wider">Gross Margin</span>
          </div>
          <span className={`text-lg font-bold font-mono ${
            mColor === 'green' ? 'text-brand-green' :
            mColor === 'amber' ? 'text-accent-amber' : 'text-accent-red'
          }`}>
            {formatMargin(margin)}
          </span>
          <p className="text-[10px] text-text-tertiary mt-0.5">
            target: 65% | floor: 50%
          </p>
        </Card>
      </div>

      {/* Pricing Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>Margin Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { label: 'Current Revenue',      value: revenue,       note: formatMargin(margin),   highlight: true },
              { label: 'At Target (65%)',       value: targetRevenue, note: 'target',               highlight: false },
              { label: 'At Floor (50%)',        value: floorRevenue,  note: 'absolute minimum',     highlight: false },
            ].map(row => (
              <div key={row.label} className={`flex items-center justify-between py-2 px-3 rounded-lg ${row.highlight ? 'bg-white/[0.03] border border-white/[0.06]' : ''}`}>
                <span className="text-sm text-text-secondary">{row.label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-text-tertiary">{row.note}</span>
                  <MonoValue cents={row.value} size="sm" />
                </div>
              </div>
            ))}

            <div className={`flex items-center justify-between py-2 px-3 rounded-lg ${variance >= 0 ? 'bg-brand-green/5 border border-brand-green/20' : 'bg-accent-red/5 border border-accent-red/20'}`}>
              <span className="text-sm text-text-secondary">
                {variance >= 0 ? 'Above target by' : 'Below target by'}
              </span>
              <MonoValue
                cents={Math.abs(variance)}
                size="sm"
                color={variance >= 0 ? 'text-brand-green' : 'text-accent-red'}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Client Info */}
      <Card>
        <CardHeader>
          <CardTitle>Client</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between">
            <div>
              <p className="font-medium text-text-primary">{job.client?.name}</p>
              {job.client?.company_name && (
                <p className="text-sm text-text-secondary">{job.client.company_name}</p>
              )}
              {job.client?.email && (
                <p className="text-xs text-text-tertiary mt-1 font-mono">{job.client.email}</p>
              )}
              {job.client?.phone && (
                <p className="text-xs text-text-tertiary font-mono">{job.client.phone}</p>
              )}
            </div>
            <Link href={`/clients/${job.client_id}`} className="text-[11px] text-brand-green hover:underline">
              View client →
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
