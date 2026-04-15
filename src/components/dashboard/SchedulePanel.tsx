'use client'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Calendar, Clock, MapPin } from 'lucide-react'
import { format, isToday, isTomorrow } from 'date-fns'

interface ScheduleEvent {
  id: string
  title: string
  time?: string
  location?: string
  type: 'job' | 'meeting' | 'walkthrough' | 'deadline'
  crew?: string[]
  date: string
}

// Mock schedule data — replace with Google Calendar / Jobber sync
const MOCK_SCHEDULE: ScheduleEvent[] = [
  {
    id: '1',
    title: 'Haas Residence — Final Clean',
    time: '7:30 AM',
    location: 'Gilbert, AZ',
    type: 'job',
    crew: ['Stacy', 'Johao'],
    date: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Lanai Living Buckeye — Day 3',
    time: '8:00 AM',
    location: 'Buckeye, AZ',
    type: 'job',
    crew: ['David', 'Jesus'],
    date: new Date().toISOString(),
  },
  {
    id: '3',
    title: 'Walkthrough — Silver Sky PV',
    time: '2:00 PM',
    location: 'Paradise Valley, AZ',
    type: 'walkthrough',
    crew: ['Jorden'],
    date: new Date().toISOString(),
  },
  {
    id: '4',
    title: 'Blandford Batch Unit 4',
    time: '9:00 AM',
    location: 'Mesa, AZ',
    type: 'job',
    crew: ['Santa', 'Rosemarie'],
    date: new Date(Date.now() + 86400000).toISOString(),
  },
]

const typeStyles: Record<string, string> = {
  job:        'bg-brand-green/10 text-brand-green',
  meeting:    'bg-accent-blue/10 text-accent-blue',
  walkthrough:'bg-accent-amber/10 text-accent-amber',
  deadline:   'bg-accent-red/10 text-accent-red',
}

export function SchedulePanel() {
  const todayItems = MOCK_SCHEDULE.filter(e => isToday(new Date(e.date)))
  const tomorrowItems = MOCK_SCHEDULE.filter(e => isTomorrow(new Date(e.date)))

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-text-tertiary" />
          <CardTitle>Today&apos;s Schedule</CardTitle>
        </div>
        <span className="text-[11px] text-text-tertiary font-mono">
          {format(new Date(), 'MMM d')}
        </span>
      </CardHeader>

      <div className="divide-y divide-white/[0.04]">
        {todayItems.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-text-tertiary">Nothing scheduled today</div>
        ) : (
          todayItems.map(event => (
            <div key={event.id} className="flex gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors">
              <div className="flex-shrink-0 w-[52px] text-right pt-0.5">
                <span className="text-[11px] text-text-tertiary font-mono">{event.time}</span>
              </div>
              <div className="w-px bg-white/10 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary truncate">{event.title}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeStyles[event.type]} hidden sm:inline`}>
                    {event.type}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {event.location && (
                    <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
                      <MapPin className="w-2.5 h-2.5" />
                      {event.location}
                    </span>
                  )}
                  {event.crew && event.crew.length > 0 && (
                    <span className="text-[11px] text-text-tertiary">
                      {event.crew.join(', ')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}

        {tomorrowItems.length > 0 && (
          <>
            <div className="px-4 py-2 bg-white/[0.01]">
              <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">Tomorrow</span>
            </div>
            {tomorrowItems.map(event => (
              <div key={event.id} className="flex gap-3 px-4 py-3 opacity-60">
                <div className="flex-shrink-0 w-[52px] text-right pt-0.5">
                  <span className="text-[11px] text-text-tertiary font-mono">{event.time}</span>
                </div>
                <div className="w-px bg-white/10 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{event.title}</p>
                  {event.location && (
                    <p className="text-[11px] text-text-tertiary mt-0.5">{event.location}</p>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </Card>
  )
}
