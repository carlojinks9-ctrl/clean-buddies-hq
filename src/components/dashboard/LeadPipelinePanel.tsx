'use client'
import Link from 'next/link'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { MonoValue } from '@/components/ui/MonoValue'
import { Skeleton } from '@/components/ui/Skeleton'
import { ArrowRight, Users } from 'lucide-react'
import { format } from 'date-fns'
import type { Lead } from '@/types'

interface LeadPipelinePanelProps {
  leads: Lead[]
  loading?: boolean
}

const statusBadge: Record<string, { variant: any; label: string }> = {
  new:       { variant: 'blue',   label: 'New' },
  contacted: { variant: 'amber',  label: 'Contacted' },
  bid_sent:  { variant: 'purple', label: 'Bid Sent' },
  won:       { variant: 'green',  label: 'Won' },
  lost:      { variant: 'gray',   label: 'Lost' },
}

export function LeadPipelinePanel({ leads, loading }: LeadPipelinePanelProps) {
  const activeCounts = leads.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-text-tertiary" />
          <CardTitle>Lead Pipeline</CardTitle>
        </div>
        <Link href="/clients" className="text-[11px] text-text-tertiary hover:text-brand-green flex items-center gap-1 transition-colors">
          All leads <ArrowRight className="w-3 h-3" />
        </Link>
      </CardHeader>

      {/* Pipeline summary row */}
      <div className="flex gap-1 px-4 py-2 border-b border-white/[0.04] overflow-x-auto">
        {Object.entries(statusBadge).map(([key, { variant, label }]) => (
          <span key={key} className="flex-shrink-0 flex items-center gap-1">
            <Badge variant={variant} dot>
              {label} {activeCounts[key] ? `(${activeCounts[key]})` : ''}
            </Badge>
          </span>
        ))}
      </div>

      <div className="divide-y divide-white/[0.04]">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <Skeleton className="h-3 w-40 mb-1.5" />
              <Skeleton className="h-2.5 w-56" />
            </div>
          ))
        ) : leads.filter(l => l.status !== 'lost').slice(0, 6).map(lead => {
          const badge = statusBadge[lead.status]
          return (
            <Link
              key={lead.id}
              href={`/clients?lead=${lead.id}`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary truncate group-hover:text-brand-green transition-colors">
                    {lead.name}
                  </p>
                  {lead.company && (
                    <span className="text-[11px] text-text-tertiary hidden sm:block">· {lead.company}</span>
                  )}
                </div>
                <p className="text-[11px] text-text-tertiary mt-0.5 truncate">
                  {lead.service_type} · {format(new Date(lead.created_at), 'MMM d')}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <Badge variant={badge.variant}>{badge.label}</Badge>
                {lead.estimated_value_cents && (
                  <MonoValue cents={lead.estimated_value_cents} size="sm" color="text-text-secondary" />
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </Card>
  )
}
