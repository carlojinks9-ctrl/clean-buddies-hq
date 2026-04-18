import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Same shape as SchedulePanel expects
export interface ScheduleEvent {
  id: string
  title: string
  time?: string
  location?: string
  type: 'job' | 'meeting' | 'walkthrough' | 'deadline'
  date: string       // ISO string
  isAllDay?: boolean
  htmlLink?: string | null
  description?: string | null
}

const DAYS_AHEAD = 14

export async function GET() {
  const icalUrl = process.env.JOBBER_ICAL_URL

  if (!icalUrl) {
    return NextResponse.json({
      ok: false,
      error: 'JOBBER_ICAL_URL is not configured',
      configured: false,
      events: [],
    })
  }

  // ── Fetch feed ──────────────────────────────────────────────────────────
  let icsText: string
  try {
    const res = await fetch(icalUrl, {
      headers: { Accept: 'text/calendar, */*' },
      // No caching — always fetch fresh for schedule display
      cache: 'no-store',
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    icsText = await res.text()
    if (!icsText.includes('BEGIN:VCALENDAR')) {
      throw new Error('Response does not look like a valid iCal feed (missing BEGIN:VCALENDAR)')
    }
  } catch (err) {
    console.error('[sync/ical] Fetch failed:', err)
    return NextResponse.json({
      ok: false,
      configured: true,
      error: `Failed to fetch iCal feed: ${String(err)}`,
      events: [],
    })
  }

  // ── Parse ───────────────────────────────────────────────────────────────
  let allEvents: ScheduleEvent[]
  try {
    allEvents = parseIcs(icsText)
  } catch (err) {
    console.error('[sync/ical] Parse failed:', err)
    return NextResponse.json({
      ok: false,
      configured: true,
      error: `Failed to parse iCal data: ${String(err)}`,
      events: [],
    })
  }

  // ── Filter to upcoming window ────────────────────────────────────────────
  // Start of today (midnight Phoenix time)
  const nowMs = Date.now()
  const cutoffMs = nowMs + DAYS_AHEAD * 24 * 60 * 60 * 1000
  // For all-day comparisons use local date string
  const todayPhoenix = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' }) // YYYY-MM-DD

  const upcoming = allEvents
    .filter(e => {
      if (e.isAllDay) {
        // All-day: compare date strings directly (e.date is YYYY-MM-DD for all-day)
        return e.date >= todayPhoenix
      }
      const ms = new Date(e.date).getTime()
      return ms >= nowMs && ms <= cutoffMs
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 40)  // cap for performance

  console.log(`[sync/ical] Parsed ${allEvents.length} events, ${upcoming.length} upcoming`)

  return NextResponse.json({
    ok: true,
    configured: true,
    source: 'jobber_ical',
    events: upcoming,
    total_in_feed: allEvents.length,
    fetched_at: new Date().toISOString(),
  })
}

// ── Minimal iCal (.ics) parser ───────────────────────────────────────────────
// Handles: VEVENT, DTSTART/DTEND (UTC, TZID, VALUE=DATE), SUMMARY, DESCRIPTION,
//          LOCATION, UID. Skips RRULE expansion — base event only.

function parseIcs(raw: string): ScheduleEvent[] {
  // 1. Unfold lines (RFC 5545 §3.1 — continuation starts with SPACE or TAB)
  const text = raw.replace(/\r\n([ \t])/g, '$1').replace(/\n([ \t])/g, '$1')
  const lines = text.split(/\r?\n/)

  const events: ScheduleEvent[] = []
  let inEvent = false
  let props: Record<string, string> = {}   // baseKey → value
  let paramMap: Record<string, string> = {} // baseKey → raw params string

  for (const rawLine of lines) {
    if (!rawLine) continue
    const line = rawLine  // preserve case for values

    if (line === 'BEGIN:VEVENT') {
      inEvent = true
      props = {}
      paramMap = {}
      continue
    }
    if (line === 'END:VEVENT') {
      inEvent = false
      const ev = buildEvent(props, paramMap)
      if (ev) events.push(ev)
      continue
    }
    if (!inEvent) continue

    // Split property name (with optional params) from value on first ':'
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const keyFull = line.slice(0, colon)
    const value = line.slice(colon + 1)

    const semi = keyFull.indexOf(';')
    const baseKey = (semi >= 0 ? keyFull.slice(0, semi) : keyFull).toUpperCase()
    if (semi >= 0) paramMap[baseKey] = keyFull.slice(semi + 1)

    // Don't overwrite — first occurrence wins (handles DTSTART before DTSTART in recurrence)
    if (!(baseKey in props)) props[baseKey] = value
  }

  return events
}

function buildEvent(
  props: Record<string, string>,
  paramMap: Record<string, string>
): ScheduleEvent | null {
  const uid = props.UID || `ical-${Math.random().toString(36).slice(2)}`
  const summary = unescapeIcal(props.SUMMARY || '').trim()
  const dtstart = props.DTSTART
  if (!dtstart) return null

  const { date, isAllDay } = parseDtstart(dtstart, paramMap.DTSTART || '')
  if (!date) return null

  const description = unescapeIcal(props.DESCRIPTION || '').replace(/\\n/g, ' ').trim() || null
  const location = unescapeIcal(props.LOCATION || '').trim() || null
  const title = summary || 'Jobber Event'
  const type = classifyEvent(title, description)

  return {
    id: uid,
    title,
    time: isAllDay ? undefined : formatTime(date),
    location: location || undefined,
    type,
    // All-day → plain date string; timed → full ISO
    date: isAllDay
      ? formatDateOnly(date)
      : date.toISOString(),
    isAllDay,
    description,
    htmlLink: null,
  }
}

// ── Date parsing ─────────────────────────────────────────────────────────────

function parseDtstart(value: string, params: string): { date: Date | null; isAllDay: boolean } {
  const upperParams = params.toUpperCase()

  // All-day: VALUE=DATE or 8-char value like 20260418
  if (upperParams.includes('VALUE=DATE') || /^\d{8}$/.test(value)) {
    const y = parseInt(value.slice(0, 4), 10)
    const m = parseInt(value.slice(4, 6), 10) - 1
    const d = parseInt(value.slice(6, 8), 10)
    // Use local date — important for all-day comparisons
    return { date: new Date(y, m, d, 0, 0, 0), isAllDay: true }
  }

  // Timed value: 20260418T090000Z  or  20260418T090000
  if (!/T/.test(value)) return { date: null, isAllDay: false }

  const y = parseInt(value.slice(0, 4), 10)
  const mo = parseInt(value.slice(4, 6), 10) - 1
  const d = parseInt(value.slice(6, 8), 10)
  const h = parseInt(value.slice(9, 11), 10)
  const mi = parseInt(value.slice(11, 13), 10)
  const s = parseInt(value.slice(13, 15), 10) || 0

  // UTC suffix Z
  if (value.endsWith('Z')) {
    return { date: new Date(Date.UTC(y, mo, d, h, mi, s)), isAllDay: false }
  }

  // TZID in params — extract and handle known offsets
  const tzidMatch = params.match(/TZID=([^;]+)/i)
  const tzid = tzidMatch ? tzidMatch[1] : ''

  if (tzid) {
    // Parse the local time string and convert using the TZID.
    // Date.parse can't handle arbitrary TZIDs, so we use Intl for the offset.
    try {
      // Build a reference date string and get offset via Intl
      const localStr = `${y}-${pad(mo+1)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`
      const dt = new Date(localStr)  // treated as local — we'll correct below
      // Get the UTC offset for this date in the TZID timezone
      const offsetMin = getTzOffsetMinutes(tzid, dt)
      const utcMs = dt.getTime() - offsetMin * 60_000
      return { date: new Date(utcMs), isAllDay: false }
    } catch {
      // Fall back: treat as UTC
      return { date: new Date(Date.UTC(y, mo, d, h, mi, s)), isAllDay: false }
    }
  }

  // No Z, no TZID — treat as "floating" local time (assume Phoenix)
  const phoenixOffsetMin = 7 * 60  // UTC-7 (Arizona, no DST)
  return {
    date: new Date(Date.UTC(y, mo, d, h, mi + phoenixOffsetMin, s)),
    isAllDay: false,
  }
}

/** Get UTC offset in minutes for a given IANA timezone at a given moment. */
function getTzOffsetMinutes(tzid: string, date: Date): number {
  try {
    // Use Intl to format in UTC and in the target TZ, then diff
    const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
    const tzStr = date.toLocaleString('en-US', { timeZone: tzid })
    const utcDate = new Date(utcStr)
    const tzDate = new Date(tzStr)
    return (tzDate.getTime() - utcDate.getTime()) / 60_000
  } catch {
    return 0
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Phoenix',
  })
}

function formatDateOnly(date: Date): string {
  // YYYY-MM-DD in local time
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  return `${y}-${m}-${d}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// ── Classification ───────────────────────────────────────────────────────────

function classifyEvent(
  title: string,
  description: string | null
): 'job' | 'meeting' | 'walkthrough' | 'deadline' {
  const text = (title + ' ' + (description || '')).toLowerCase()
  if (text.includes('walkthrough') || text.includes('walk through') || text.includes('bid')) return 'walkthrough'
  if (
    text.includes('clean') || text.includes('job') || text.includes('visit') ||
    text.includes('service') || text.includes('unit') || text.includes('residence')
  ) return 'job'
  if (text.includes('deadline') || text.includes('due') || text.includes('invoice')) return 'deadline'
  return 'meeting'
}

// ── iCal escape sequences ────────────────────────────────────────────────────

function unescapeIcal(s: string): string {
  return s
    .replace(/\\n/g, ' ')
    .replace(/\\N/g, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}
