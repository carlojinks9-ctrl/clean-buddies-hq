'use client'
import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Calendar, Clock, MapPin, ExternalLink } from 'lucide-react'
import { format, isToday, isTomorrow, parseISO } from 'date-fns'

interface ScheduleEvent {
  id: string
  title: string
  time?: string
  location?: string
  type: 'job' | 'meeting' | 'walkthrough' | 'deadline'
  date: string
  isAllDay?: boolean
  htmlLink?: string | null
}

const typeStyles: Record<string, string> = {
  job:        'bg-brand-green/10 text-brand-green',
  meeting:    'bg-accent-blue/10 text-accent-blue',
  walkthrough:'bg-accent-amber/10 text-accent-amber',
  deadline:   'bg-accent-red/10 text-accent-red',
}

type ScheduleSource = 'jobber' | 'google' | 'none'

export function SchedulePanel() {
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(true)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [source, setSource] = useState<ScheduleSource>('none')
  const [icalError, setIcalError] = useState<string | null>(null)

  useEffect(() => {
    // 1. Try Jobber iCal (primary)
    fetch('/api/sync/ical')
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.source === 'jobber_ical') {
          setEvents(data.events || [])
          setFetchedAt(data.fetched_at || null)
          setSource('jobber')
          setConnected(true)
        } else if (data.configured === false) {
          // iCal not configured — fall back to Google
          return fetch('/api/sync/google')
            .then(r => r.json())
            .then(gData => {
              if (gData.error === 'Google not connected') {
                setConnected(false)
                setSource('none')
              } else {
                setEvents(gData.events || [])
                setFetchedAt(gData.fetched_at || null)
                setSource('google')
                setConnected(true)
              }
            })
        } else {
          // iCal configured but fetch/parse failed
          setIcalError(data.error || 'Failed to load Jobber schedule')
          setConnected(false)
          setSource('none')
        }
      })
      .catch(() => setConnected(false))
      .finally(() => setLoading(false))
  }, [])

  const safeDate = (d: string) => {
    try { return parseISO(d) } catch { return new Date(d) }
  }

  const todayItems = events.filter(e => { try { return isToday(safeDate(e.date)) } catch { return false } })
  const tomorrowItems = events.filter(e => { try { return isTomorrow(safeDate(e.date)) } catch { return false } })
  const laterItems = events.filter(e => {
    try {
      const d = safeDate(e.date)
      return !isToday(d) && !isTomorrow(d)
    } catch { return false }
  }).slice(0, 3)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-text-tertiary" />
          <CardTitle>Schedule</CardTitle>
          {source === 'jobber' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-green/10 text-brand-green font-medium">Jobber</span>
          )}
          {source === 'google' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue font-medium">Google</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <div className="w-3 h-3 rounded-full border border-white/20 border-t-white/60 animate-spin" />
          ) : connected ? (
            <span className="text-[11px] text-text-tertiary font-mono">
              {fetchedAt ? `synced ${format(new Date(fetchedAt), 'h:mm a')}` : format(new Date(), 'MMM d')}
            </span>
          ) : icalError ? (
            <span className="text-[11px] text-accent-red" title={icalError}>⚠ iCal error</span>
          ) : (
            <a href="/settings" className="text-[11px] text-accent-amber hover:underline">
              Connect →
            </a>
          )}
        </div>
      </CardHeader>

      <div className="divide-y divide-white/[0.04]">
        {loading ? (
          <div className="px-4 py-6 space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="w-12 h-3 bg-white/[0.05] rounded" />
                <div className="w-px bg-white/10" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-white/[0.05] rounded w-3/4" />
                  <div className="h-2.5 bg-white/[0.03] rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : !connected ? (
          <div className="px-4 py-6 text-center space-y-2">
            <Calendar className="w-6 h-6 text-text-tertiary mx-auto opacity-40" />
            {icalError ? (
              <>
                <p className="text-xs text-accent-red">Jobber schedule unavailable</p>
                <p className="text-[11px] text-text-tertiary px-2">{icalError}</p>
                <a href="/settings" className="text-xs text-accent-blue hover:underline">Check Settings →</a>
              </>
            ) : (
              <>
                <p className="text-xs text-text-tertiary">No schedule source connected</p>
                <p className="text-[11px] text-text-tertiary">Set JOBBER_ICAL_URL or connect Google Calendar</p>
                <a href="/settings" className="text-xs text-accent-blue hover:underline">Settings →</a>
              </>
            )}
          </div>
        ) : (
          <>
            {todayItems.length === 0 && tomorrowItems.length === 0 && laterItems.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-text-tertiary">Nothing scheduled in the next 7 days</div>
            ) : (
              <>
                {todayItems.length > 0 && (
                  <div className="px-4 py-2 bg-white/[0.01]">
                    <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">Today · {format(new Date(), 'MMM d')}</span>
                  </div>
                )}
                {todayItems.map(event => (
                  <EventRow key={event.id} event={event} typeStyles={typeStyles} />
                ))}

                {tomorrowItems.length > 0 && (
                  <div className="px-4 py-2 bg-white/[0.01]">
                    <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">Tomorrow</span>
                  </div>
                )}
                {tomorrowItems.map(event => (
                  <EventRow key={event.id} event={event} typeStyles={typeStyles} dimmed />
                ))}

                {laterItems.length > 0 && (
                  <div className="px-4 py-2 bg-white/[0.01]">
                    <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">Coming up</span>
                  </div>
                )}
                {laterItems.map(event => (
                  <EventRow key={event.id} event={event} typeStyles={typeStyles} dimmed />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

function EventRow({
  event,
  typeStyles,
  dimmed = false,
}: {
  event: ScheduleEvent
  typeStyles: Record<string, string>
  dimmed?: boolean
}) {
  return (
    <div className={`flex gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors ${dimmed ? 'opacity-60' : ''}`}>
      <div className="flex-shrink-0 w-[52px] text-right pt-0.5">
        <span className="text-[11px] text-text-tertiary font-mono leading-tight">
          {event.isAllDay ? 'All day' : (event.time || '—')}
        </span>
      </div>
      <div className="w-px bg-white/10 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-text-primary truncate">{event.title}</p>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeStyles[event.type] || typeStyles.meeting} hidden sm:inline flex-shrink-0`}>
            {event.type}
          </span>
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        {event.location && (
          <span className="flex items-center gap-1 text-[11px] text-text-tertiary mt-0.5">
            <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
            <span className="truncate">{event.location}</span>
          </span>
        )}
      </div>
    </div>
  )
}
