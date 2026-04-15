import type { SupabaseClient } from '@supabase/supabase-js'

export async function handleLeadsCommand(db: SupabaseClient): Promise<string> {
  try {
    const { data: leads } = await db
      .from('leads')
      .select('name, company, status, estimated_value_cents, created_at')
      .neq('status', 'lost')
      .order('created_at', { ascending: false })
      .limit(10)

    if (!leads || leads.length === 0) {
      return '📋 No active leads in pipeline.'
    }

    const statusEmoji: Record<string, string> = {
      new: '🆕',
      contacted: '📞',
      bid_sent: '📄',
      won: '✅',
    }

    const lines = leads.map(l => {
      const emoji = statusEmoji[l.status] || '•'
      const name = l.company || l.name
      const value = l.estimated_value_cents
        ? ` — $${(l.estimated_value_cents / 100).toLocaleString()}`
        : ''
      return `${emoji} ${name}${value}`
    })

    const totalValue = leads.reduce((s, l) => s + (l.estimated_value_cents || 0), 0)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://clean-buddies-hq.vercel.app'

    return (
      `📋 <b>Lead Pipeline (${leads.length} active)</b>\n\n` +
      lines.join('\n') +
      `\n\nPipeline value: <b>$${(totalValue / 100).toLocaleString()}</b>\n` +
      `<a href="${appUrl}/clients">View full pipeline →</a>`
    )
  } catch {
    return '❌ Could not fetch leads.'
  }
}
