import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { refreshGoogleToken, getCalendarEvents } from '@/lib/google'
import { addDays, startOfDay } from 'date-fns'

export async function GET() {
  const db = createServerClient()

  const { data: tokenRow } = await db
    .from('integration_tokens')
    .select('*')
    .eq('service', 'google')
    .single()

  if (!tokenRow) {
    return NextResponse.json({ error: 'Google not connected', events: [] }, { status: 200 })
  }

  let accessToken = tokenRow.access_token

  // Refresh if within 60s of expiry
  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() - 60_000 < Date.now()) {
    try {
      const refreshed = await refreshGoogleToken(tokenRow.refresh_token!)
      accessToken = refreshed.access_token
      await db.from('integration_tokens').update({
        access_token: refreshed.access_token,
        ...(refreshed.refresh_token ? { refresh_token: refreshed.refresh_token } : {}),
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      }).eq('service', 'google')
    } catch (err) {
      return NextResponse.json({ error: 'Token refresh failed', events: [] }, { status: 200 })
    }
  }

  try {
    const now = startOfDay(new Date())
    const timeMin = now.toISOString()
    const timeMax = addDays(now, 7).toISOString()

    const data = await getCalendarEvents(accessToken, timeMin, timeMax)
    const rawEvents = data.items || []

    // Normalize Google Calendar events to our display format
    const events = rawEvents.map((ev: any) => {
      const start = ev.start?.dateTime || ev.start?.date || ''
      const isAllDay = !ev.start?.dateTime
      const time = isAllDay ? 'All day' : new Date(start).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Phoenix',
      })

      // Classify event type based on title keywords
      const title = (ev.summary || 'Event').toLowerCase()
      let type = 'meeting'
      if (title.includes('walkthrough') || title.includes('walk through') || title.includes('bid')) {
        type = 'walkthrough'
      } else if (title.includes('clean') || title.includes('job') || title.includes('unit') || title.includes('residence')) {
        type = 'job'
      } else if (title.includes('deadline') || title.includes('due') || title.includes('invoice')) {
        type = 'deadline'
      }

      return {
        id: ev.id,
        title: ev.summary || 'Event',
        time,
        location: ev.location || null,
        type,
        date: start,
        isAllDay,
        description: ev.description || null,
        htmlLink: ev.htmlLink || null,
      }
    })

    return NextResponse.json({ ok: true, events, fetched_at: new Date().toISOString() })
  } catch (err) {
    console.error('[sync/google] Calendar error:', err)
    return NextResponse.json({ error: String(err), events: [] }, { status: 200 })
  }
}
