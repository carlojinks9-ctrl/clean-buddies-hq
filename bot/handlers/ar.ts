import type { SupabaseClient } from '@supabase/supabase-js'

export async function handleArCommand(db: SupabaseClient): Promise<string> {
  try {
    const { data: invoices } = await db
      .from('invoices')
      .select('invoice_number, balance_cents, status, due_date, client:clients(name, company_name)')
      .in('status', ['sent', 'overdue'])
      .order('due_date', { ascending: true })

    if (!invoices || invoices.length === 0) {
      return '✅ No outstanding AR. All caught up!'
    }

    const totalAr = invoices.reduce((s, i) => s + i.balance_cents, 0)
    const overdueInvoices = invoices.filter(i => i.status === 'overdue')

    const lines = invoices.slice(0, 8).map(inv => {
      const client = (inv.client as any)?.company_name || (inv.client as any)?.name || '?'
      const dollars = `$${(inv.balance_cents / 100).toLocaleString()}`
      const overdue = inv.status === 'overdue' ? ' ⚠️' : ''
      const due = inv.due_date
        ? ` (due ${new Date(inv.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
        : ''
      return `• ${client}: ${dollars}${due}${overdue}`
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://clean-buddies-hq.vercel.app'

    return (
      `💰 <b>Outstanding AR — $${(totalAr / 100).toLocaleString()}</b>\n\n` +
      lines.join('\n') +
      (overdueInvoices.length > 0
        ? `\n\n⚠️ ${overdueInvoices.length} overdue — <b>$${(overdueInvoices.reduce((s, i) => s + i.balance_cents, 0) / 100).toLocaleString()}</b>`
        : '') +
      `\n\n<a href="${appUrl}/financials">View AR Aging →</a>`
    )
  } catch {
    return '❌ Could not fetch AR data.'
  }
}
