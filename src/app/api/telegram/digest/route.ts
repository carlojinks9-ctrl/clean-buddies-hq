import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { sendDailyDigest } from '@/lib/telegram'
import { subDays, startOfDay, endOfDay } from 'date-fns'

// Triggered by Vercel Cron at 14:00 UTC (7am AZ time — Arizona doesn't observe DST)
// Also callable manually from Settings page

export async function POST(request: NextRequest) {
  // Auth: either cron secret header or internal call
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServerClient()
  const now = new Date()
  const yesterdayStart = startOfDay(subDays(now, 1)).toISOString()
  const yesterdayEnd = endOfDay(subDays(now, 1)).toISOString()

  const [jobsRes, suppliesRes, invoicesRes, leadsRes] = await Promise.all([
    db.from('jobs')
      .select('title, status, clients(name)')
      .in('status', ['active', 'scheduled']),

    db.from('supply_requests')
      .select('item_name, quantity, job_name')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),

    db.from('invoices')
      .select('invoice_number, balance_cents, due_date, clients(name)')
      .eq('status', 'overdue')
      .order('due_date', { ascending: true }),

    db.from('leads')
      .select('name, service_type')
      .gte('created_at', yesterdayStart)
      .lte('created_at', yesterdayEnd),
  ])

  const today = new Date()

  const jobs_active = (jobsRes.data || []).map((j: any) => ({
    title: j.title,
    client: j.clients?.name || '',
  }))

  const pending_supplies = (suppliesRes.data || []).map((s: any) => ({
    item_name: s.item_name,
    quantity: s.quantity,
    job_name: s.job_name,
  }))

  const overdue_invoices = (invoicesRes.data || []).map((inv: any) => {
    const due = new Date(inv.due_date)
    const days_overdue = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000))
    return {
      invoice_number: inv.invoice_number,
      client: inv.clients?.name || 'Unknown',
      balance_cents: inv.balance_cents || 0,
      days_overdue,
    }
  })

  const new_leads = (leadsRes.data || []).map((l: any) => ({
    name: l.name,
    service_type: l.service_type,
  }))

  await sendDailyDigest({ jobs_active, pending_supplies, overdue_invoices, new_leads })

  return NextResponse.json({
    ok: true,
    sent_at: now.toISOString(),
    counts: {
      jobs: jobs_active.length,
      supplies: pending_supplies.length,
      invoices: overdue_invoices.length,
      leads: new_leads.length,
    },
  })
}
