'use client'
import Link from 'next/link'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { StatusDot } from '@/components/ui/StatusDot'
import { MarginBadge } from '@/components/ui/MarginBadge'
import { MonoValue } from '@/components/ui/MonoValue'
import { Skeleton } from '@/components/ui/Skeleton'
import { ArrowRight, Briefcase } from 'lucide-react'
import type { Job } from '@/types'

interface ActiveJobsPanelProps {
  jobs: Job[]
  loading?: boolean
}

export function ActiveJobsPanel({ jobs, loading }: ActiveJobsPanelProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-text-tertiary" />
          <CardTitle>Active Jobs</CardTitle>
          <span className="ml-1 px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-text-tertiary font-mono">
            {jobs.filter(j => j.status === 'active' || j.status === 'scheduled').length}
          </span>
        </div>
        <Link href="/jobs" className="text-[11px] text-text-tertiary hover:text-brand-green flex items-center gap-1 transition-colors">
          All jobs <ArrowRight className="w-3 h-3" />
        </Link>
      </CardHeader>

      <div className="divide-y divide-white/[0.04]">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3">
              <Skeleton className="w-2 h-2 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-3 w-48 mb-1.5" />
                <Skeleton className="h-2.5 w-32" />
              </div>
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-12" />
            </div>
          ))
        ) : jobs.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-text-tertiary">No active jobs</div>
        ) : (
          jobs.slice(0, 6).map(job => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors group"
            >
              <StatusDot status={job.status as any} pulse={job.status === 'active'} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate group-hover:text-brand-green transition-colors">
                  {job.title}
                </p>
                <p className="text-[11px] text-text-tertiary truncate">
                  {job.client?.name || job.client?.company_name || '—'} · {job.job_number}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <MonoValue cents={job.contract_value_cents} size="sm" />
                <div className="mt-0.5">
                  <MarginBadge margin={job.gross_margin} />
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          ))
        )}
      </div>
    </Card>
  )
}
