'use client'
import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Flag } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { formatDuration, QUO_MISSED_STATUSES } from '@/lib/quo'
import type { QuoCall } from '@/types'

export function RecentCallsWidget() {
  const [calls, setCalls] = useState<QuoCall[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('quo_calls')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(6)
      setCalls((data ?? []) as QuoCall[])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Phone className="w-4 h-4 text-text-tertiary" />
          <CardTitle>Recent Calls</CardTitle>
        </div>
        <a href="/communications" className="text-[11px] text-accent-blue hover:underline">
          View all →
        </a>
      </CardHeader>

      <div className="px-4 pb-3 space-y-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 rounded-lg bg-white/[0.03] animate-pulse" />
          ))
        ) : calls.length === 0 ? (
          <p className="text-xs text-text-tertiary text-center py-4">No calls synced yet</p>
        ) : (
          calls.map(call => {
            const isMissed = QUO_MISSED_STATUSES.has(call.status ?? '')
            const displayName = call.contact_name ?? (call.direction === 'inbound' ? call.from_number : call.to_number)

            return (
              <a
                key={call.id}
                href="/communications"
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors group"
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isMissed
                    ? 'bg-accent-red/10'
                    : call.direction === 'inbound'
                    ? 'bg-accent-blue/10'
                    : 'bg-brand-green/10'
                }`}>
                  {isMissed ? (
                    <PhoneMissed className="w-3.5 h-3.5 text-accent-red" />
                  ) : call.direction === 'inbound' ? (
                    <PhoneIncoming className="w-3.5 h-3.5 text-accent-blue" />
                  ) : (
                    <PhoneOutgoing className="w-3.5 h-3.5 text-brand-green" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-text-primary truncate">{displayName}</p>
                    {call.is_flagged && (
                      <Flag className="w-3 h-3 text-accent-amber flex-shrink-0" />
                    )}
                  </div>
                  {call.ai_summary ? (
                    <p className="text-[10px] text-text-tertiary truncate">{call.ai_summary}</p>
                  ) : (
                    <p className="text-[10px] text-text-tertiary">
                      {isMissed ? 'Missed' : formatDuration(call.duration_seconds)}
                    </p>
                  )}
                </div>

                <span className="text-[10px] text-text-tertiary font-mono flex-shrink-0">
                  {formatDistanceToNow(new Date(call.created_at), { addSuffix: false })}
                </span>
              </a>
            )
          })
        )}
      </div>
    </Card>
  )
}
