import Link from 'next/link'
import { createServerClient } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { StatusDot } from '@/components/ui/StatusDot'
import { MarginBadge } from '@/components/ui/MarginBadge'
import { MonoValue } from '@/components/ui/MonoValue'
import { Badge } from '@/components/ui/Badge'
import { ArrowRight, Filter } from 'lucide-react'
import { formatCents, grossMargin, formatMargin } from '@/lib/margin'
import { format } from 'date-fns'
import type { Job } from '@/types'

async function getJobs() {
  try {
    const db = createServerClient()
    const { data } = await db
      .from('jobs')
      .select('*, client:clients(id, name, company_name)')
      .order('updated_at', { ascending: false })
    return (data || []) as Job[]
  } catch {
    return []
  }
}

const statusMeta: Record<string, { variant: any; label: string }> = {
  active:    { variant: 'green',  label: 'Active' },
  scheduled: { variant: 'amber',  label: 'Scheduled' },
  completed: { variant: 'blue',   label: 'Completed' },
  invoiced:  { variant: 'purple', label: 'Invoiced' },
  issue:     { variant: 'red',    label: 'Issue' },
}

export default async function JobsPage() {
  const jobs = await getJobs()

  const totalRevenue = jobs.reduce((s, j) => s + j.contract_value_cents, 0)
  const totalLabor = jobs.reduce((s, j) => s + j.burdened_labor_cents, 0)
  const blendedMargin = grossMargin(totalRevenue, totalLabor)

  return (
    <div className="space-y-5">
      {/* Summary row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Total Contract Value</p>
          <MonoValue cents={totalRevenue} size="xl" />
        </div>
        <div className="card p-4">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Burdened Labor</p>
          <MonoValue cents={totalLabor} size="xl" />
        </div>
        <div className="card p-4">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Blended Margin</p>
          <span className="text-xl font-bold font-mono" style={{
            color: blendedMargin >= 0.65 ? '#1D9E75' : blendedMargin >= 0.50 ? '#EF9F27' : '#E24B4A'
          }}>
            {formatMargin(blendedMargin)}
          </span>
        </div>
      </div>

      {/* Jobs list */}
      <Card>
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">All Jobs</h2>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 text-[11px] text-text-secondary hover:text-text-primary px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors">
              <Filter className="w-3 h-3" /> Filter
            </button>
          </div>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-white/[0.04]">
          {jobs.length === 0 ? (
            <p className="p-6 text-sm text-text-tertiary text-center">No jobs yet.</p>
          ) : jobs.map(job => {
            const meta = statusMeta[job.status]
            return (
              <Link key={job.id} href={`/jobs/${job.id}`} className="block p-4 hover:bg-white/[0.02] transition-colors active:bg-white/[0.04]">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text-primary truncate">{job.title}</p>
                    <p className="text-[11px] text-text-tertiary mt-0.5">
                      {(job.client as any)?.company_name || (job.client as any)?.name || '—'}
                      {job.job_number && ` · ${job.job_number}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <StatusDot status={job.status as any} pulse={job.status === 'active'} />
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-[10px] text-text-tertiary mb-0.5">Contract</p>
                    <MonoValue cents={job.contract_value_cents} size="sm" />
                  </div>
                  <div>
                    <p className="text-[10px] text-text-tertiary mb-0.5">Labor</p>
                    <MonoValue cents={job.burdened_labor_cents} size="sm" color="text-text-secondary" />
                  </div>
                  <div>
                    <p className="text-[10px] text-text-tertiary mb-0.5">Margin</p>
                    <MarginBadge margin={job.gross_margin} />
                  </div>
                  {job.start_date && (
                    <div className="ml-auto">
                      <p className="text-[10px] text-text-tertiary mb-0.5">Date</p>
                      <span className="text-[11px] text-text-tertiary font-mono">
                        {format(new Date(job.start_date), 'MMM d')}
                        {job.end_date ? ` → ${format(new Date(job.end_date), 'MMM d')}` : ''}
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            )
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job / Client</th>
                <th>Status</th>
                <th className="text-right">Contract</th>
                <th className="text-right">Labor</th>
                <th className="text-right">Margin</th>
                <th>Date Range</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => {
                const meta = statusMeta[job.status]
                return (
                  <tr key={job.id} className="hover:bg-white/[0.02] cursor-pointer">
                    <td>
                      <Link href={`/jobs/${job.id}`} className="block">
                        <p className="font-medium text-text-primary hover:text-brand-green transition-colors">
                          {job.title}
                        </p>
                        <p className="text-[11px] text-text-tertiary">
                          {(job.client as any)?.company_name || (job.client as any)?.name || '—'}
                          {job.job_number && ` · ${job.job_number}`}
                        </p>
                      </Link>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <StatusDot status={job.status as any} pulse={job.status === 'active'} />
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </div>
                    </td>
                    <td className="text-right">
                      <MonoValue cents={job.contract_value_cents} size="sm" />
                    </td>
                    <td className="text-right">
                      <MonoValue cents={job.burdened_labor_cents} size="sm" color="text-text-secondary" />
                    </td>
                    <td className="text-right">
                      <MarginBadge margin={job.gross_margin} />
                    </td>
                    <td>
                      <span className="text-[11px] text-text-tertiary font-mono">
                        {job.start_date ? format(new Date(job.start_date), 'MMM d') : '—'}
                        {job.end_date ? ` → ${format(new Date(job.end_date), 'MMM d')}` : ''}
                      </span>
                    </td>
                    <td>
                      <Link href={`/jobs/${job.id}`}>
                        <ArrowRight className="w-3.5 h-3.5 text-text-tertiary hover:text-text-primary transition-colors" />
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
