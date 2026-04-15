import type { SupabaseClient } from '@supabase/supabase-js'

export async function handleMarginCommand(db: SupabaseClient, jobName: string): Promise<string> {
  try {
    const { data: jobs } = await db
      .from('jobs')
      .select('title, contract_value_cents, burdened_labor_cents, gross_margin, total_hours, status')
      .ilike('title', `%${jobName}%`)
      .limit(3)

    if (!jobs || jobs.length === 0) {
      return `❌ No job found matching "${jobName}"`
    }

    const job = jobs[0]
    const marginPct = (job.gross_margin * 100).toFixed(1)
    const profit = job.contract_value_cents - job.burdened_labor_cents
    const marginEmoji = job.gross_margin >= 0.65 ? '✅' : job.gross_margin >= 0.50 ? '⚠️' : '🔴'

    return (
      `${marginEmoji} <b>${job.title}</b>\n\n` +
      `Revenue: <b>$${(job.contract_value_cents / 100).toLocaleString()}</b>\n` +
      `Burdened labor: $${(job.burdened_labor_cents / 100).toLocaleString()} (${job.total_hours.toFixed(1)}h @ $23.10)\n` +
      `Gross profit: $${(profit / 100).toLocaleString()}\n` +
      `Margin: <b>${marginPct}%</b> (target: 65% | floor: 50%)\n` +
      `Status: ${job.status}` +
      (jobs.length > 1 ? `\n\n<i>${jobs.length - 1} other match(es) — use more specific name</i>` : '')
    )
  } catch {
    return '❌ Could not fetch job data.'
  }
}
