'use client'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Activity, DollarSign, UserPlus, Briefcase, AlertTriangle, ShoppingCart, TrendingUp } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { ActivityFeedItem } from '@/types'

interface ActivityFeedProps {
  items: ActivityFeedItem[]
  loading?: boolean
}

const EVENT_META: Record<string, { icon: any; color: string; bg: string }> = {
  invoice_paid:    { icon: DollarSign,    color: 'text-brand-green',  bg: 'bg-brand-green/10' },
  new_lead:        { icon: UserPlus,      color: 'text-accent-blue',  bg: 'bg-accent-blue/10' },
  job_started:     { icon: Briefcase,     color: 'text-brand-green',  bg: 'bg-brand-green/10' },
  job_completed:   { icon: TrendingUp,    color: 'text-accent-blue',  bg: 'bg-accent-blue/10' },
  job_issue:       { icon: AlertTriangle, color: 'text-accent-red',   bg: 'bg-accent-red/10' },
  supply_request:  { icon: ShoppingCart,  color: 'text-accent-amber', bg: 'bg-accent-amber/10' },
  lead_status:     { icon: TrendingUp,    color: 'text-brand-green',  bg: 'bg-brand-green/10' },
  invoice_overdue: { icon: AlertTriangle, color: 'text-accent-red',   bg: 'bg-accent-red/10' },
}

export function ActivityFeed({ items, loading }: ActivityFeedProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-text-tertiary" />
          <CardTitle>Activity Feed</CardTitle>
        </div>
        <span className="text-[11px] text-text-tertiary">Recent events</span>
      </CardHeader>

      <div className="px-4 py-3 space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3 items-start">
              <Skeleton className="w-7 h-7 rounded-lg flex-shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-3 w-48 mb-1.5" />
                <Skeleton className="h-2.5 w-32" />
              </div>
            </div>
          ))
        ) : items.length === 0 ? (
          <p className="text-xs text-text-tertiary text-center py-6">No recent activity</p>
        ) : (
          items.slice(0, 8).map(item => {
            const meta = EVENT_META[item.event_type] || {
              icon: Activity,
              color: 'text-text-secondary',
              bg: 'bg-white/5',
            }
            const Icon = meta.icon
            return (
              <div key={item.id} className="flex gap-3 items-start group">
                <div className={`w-7 h-7 rounded-lg ${meta.bg} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary leading-snug">{item.title}</p>
                  {item.description && (
                    <p className="text-[11px] text-text-tertiary mt-0.5 truncate">{item.description}</p>
                  )}
                </div>
                <span className="text-[10px] text-text-tertiary font-mono flex-shrink-0 mt-0.5">
                  {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                </span>
              </div>
            )
          })
        )}
      </div>
    </Card>
  )
}
