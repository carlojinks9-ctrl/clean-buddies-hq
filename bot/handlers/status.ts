import type { SupabaseClient } from '@supabase/supabase-js'

export async function handleStatusCommand(db: SupabaseClient): Promise<string> {
  try {
    const [jobsRes, leadsRes, arRes, pendingSupplyRes] = await Promise.all([
      db.from('jobs').select('title, status, contract_value_cents, gross_margin').in('status', ['active', 'scheduled']),
      db.from('leads').select('status').neq('status', 'lost').neq('status', 'won'),
      db.from('invoices').select('balance_cents').in('status', ['sent', 'overdue']),
      db.from('supply_requests').select('id').eq('status', 'pending'),
    ])

    const jobs = jobsRes.data || []
    const leads = leadsRes.data || []
    const ar = arRes.data || []
    const pendingSupplies = pendingSupplyRes.data || []

    const totalAr = ar.reduce((s, i) => s + i.balance_cents, 0)
    const activeJobs = jobs.filter(j => j.status === 'active')
    const scheduledJobs = jobs.filter(j => j.status === 'scheduled')
    const avgMargin = jobs.length > 0
      ? jobs.reduce((s, j) => s + j.gross_margin, 0) / jobs.length
      : 0

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://clean-buddies-hq.vercel.app'
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

    return (
      `📊 <b>Daily Status — ${today}</b>\n\n` +
      `🟢 Active jobs: <b>${activeJobs.length}</b>\n` +
      `🟡 Scheduled: <b>${scheduledJobs.length}</b>\n` +
      `📈 Avg margin: <b>${(avgMargin * 100).toFixed(1)}%</b>\n\n` +
      `👥 Open leads: <b>${leads.length}</b>\n` +
      `💰 Outstanding AR: <b>$${(totalAr / 100).toLocaleString()}</b>\n` +
      `🛒 Pending supplies: <b>${pendingSupplies.length}</b>\n\n` +
      `<a href="${appUrl}">Open Dashboard →</a>`
    )
  } catch {
    return '❌ Could not fetch status. Check database connection.'
  }
}
