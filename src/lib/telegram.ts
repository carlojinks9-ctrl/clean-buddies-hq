/**
 * Telegram notification helpers for the Clean Buddies management chat.
 * Uses the Bot API directly (no polling — webhook-driven).
 */

// Hardcoded fallbacks — used when env vars are empty (e.g. on first deploy)
const MGMT_CHAT_ID_FALLBACK = '-5218394283'
const CREW_CHAT_ID_FALLBACK = '-5055634372'

export const MGMT_CHAT_ID = process.env.TELEGRAM_MANAGEMENT_CHAT_ID || MGMT_CHAT_ID_FALLBACK
export const CREW_CHAT_ID = process.env.TELEGRAM_CREW_CHAT_ID || CREW_CHAT_ID_FALLBACK

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
const MGMT_CHAT = MGMT_CHAT_ID

async function sendMessage(chatId: string, text: string, parseMode: 'HTML' | 'Markdown' = 'HTML') {
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('Telegram sendMessage failed:', err)
  }
}

export async function notifyNewLead(lead: {
  name: string
  email: string
  phone: string
  service_type: string
  address: string
  message: string
}) {
  if (!MGMT_CHAT) return
  const text = `🟢 <b>New Lead</b>

<b>${lead.name}</b>
📧 ${lead.email}
📞 ${lead.phone}
🏠 ${lead.address}
🧹 ${lead.service_type}

<i>"${lead.message}"</i>

<a href="${process.env.NEXT_PUBLIC_APP_URL}/clients">View in Dashboard →</a>`

  await sendMessage(MGMT_CHAT, text)
}

export async function notifyInvoicePaid(invoice: {
  invoice_number: string
  client_name: string
  amount_cents: number
}) {
  if (!MGMT_CHAT) return
  const dollars = (invoice.amount_cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
  const text = `💰 <b>Invoice Paid</b>

Invoice #${invoice.invoice_number} from <b>${invoice.client_name}</b>
Amount: <b>${dollars}</b>

<a href="${process.env.NEXT_PUBLIC_APP_URL}/financials">View Financials →</a>`

  await sendMessage(MGMT_CHAT, text)
}

export async function notifyJobStatusChange(job: {
  title: string
  client_name: string
  status: string
  job_id: string
}) {
  if (!MGMT_CHAT) return
  const statusEmoji: Record<string, string> = {
    active: '🟢',
    scheduled: '🟡',
    completed: '🔵',
    invoiced: '💰',
    issue: '🔴',
  }
  const emoji = statusEmoji[job.status] || '⚪'
  const text = `${emoji} <b>Job Status Update</b>

<b>${job.title}</b> — ${job.client_name}
Status: <b>${job.status.toUpperCase()}</b>

<a href="${process.env.NEXT_PUBLIC_APP_URL}/jobs/${job.job_id}">View Job →</a>`

  await sendMessage(MGMT_CHAT, text)
}

export async function notifyArPastDue(arItems: Array<{ client: string; amount_cents: number; days_overdue: number }>) {
  if (!MGMT_CHAT || arItems.length === 0) return
  const lines = arItems
    .map(i => {
      const dollars = (i.amount_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      return `• ${i.client}: ${dollars} (${i.days_overdue}d overdue)`
    })
    .join('\n')

  const text = `🔴 <b>AR Past Due Reminder</b>

${lines}

<a href="${process.env.NEXT_PUBLIC_APP_URL}/financials">View AR Aging →</a>`

  await sendMessage(MGMT_CHAT, text)
}

export async function sendFlaggedMessage(
  flagged: {
    original_text: string
    sender_name: string
    severity: 'high' | 'medium' | 'low'
    category: string
    chat_title: string
  }
) {
  if (!MGMT_CHAT) return
  const severityEmoji = { high: '🔴', medium: '🟡', low: '🟢' }
  const emoji = severityEmoji[flagged.severity]
  const text = `${emoji} <b>Flagged Message — ${flagged.category.toUpperCase()}</b>

From: <b>${flagged.sender_name}</b> in ${flagged.chat_title}

<i>"${flagged.original_text}"</i>`

  await sendMessage(MGMT_CHAT, text)
}

export async function sendSupplySummary(summary: {
  count: number
  estimated_total_cents: number
  dashboard_url: string
}) {
  if (!MGMT_CHAT) return
  const dollars = (summary.estimated_total_cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
  const text = `🛒 <b>Supply Requests</b>

${summary.count} new request${summary.count !== 1 ? 's' : ''} today — estimated <b>${dollars}</b>

<a href="${summary.dashboard_url}">View Shopping List →</a>`

  await sendMessage(MGMT_CHAT, text)
}

export async function replyToMessage(chatId: string, messageId: number, text: string) {
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      reply_to_message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('Telegram reply failed:', err)
  }
}

export async function notifySupplyRequest(supply: {
  item: string
  quantity: number
  unit?: string
  job_name: string | null
  requested_by: string
  home_depot_url: string
  urgency?: number | null
}) {
  if (!MGMT_CHAT) return
  const qtyDisplay = supply.unit ? `${supply.quantity} ${supply.unit}` : String(supply.quantity)
  const urgencyLabel = supply.urgency ? `urgency ${supply.urgency}` : 'normal priority'
  const text = `📦 <b>New Supply Request</b>

From: <b>${supply.requested_by}</b>
Item: <b>${supply.item}</b> · ${qtyDisplay}
Job: ${supply.job_name || 'no job specified'}
Priority: ${urgencyLabel}

🔗 <a href="${supply.home_depot_url}">Search Home Depot →</a>
<a href="${process.env.NEXT_PUBLIC_APP_URL}/supplies">View All Requests →</a>`

  await sendMessage(MGMT_CHAT, text)
}

export async function sendDailyDigest(digest: {
  jobs_active: Array<{ title: string; client: string }>
  pending_supplies: Array<{ item_name: string; quantity: number; job_name: string | null }>
  overdue_invoices: Array<{ invoice_number: string; client: string; balance_cents: number; days_overdue: number }>
  new_leads: Array<{ name: string; service_type: string | null }>
  communications?: {
    calls_today: number
    missed_calls: number
    messages_today: number
    flagged_count: number
    top_flag: string | null
  }
}) {
  if (!MGMT_CHAT) return

  const { jobs_active, pending_supplies, overdue_invoices, new_leads, communications } = digest
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  let text = `🌅 <b>Good Morning — CB Daily Digest</b>\n<i>${today}</i>\n\n`

  // Active / scheduled jobs
  text += `📋 <b>Active Jobs (${jobs_active.length})</b>\n`
  if (jobs_active.length === 0) {
    text += `No active jobs\n`
  } else {
    jobs_active.slice(0, 6).forEach(j => { text += `• ${j.title}${j.client ? ` — ${j.client}` : ''}\n` })
    if (jobs_active.length > 6) text += `• ...and ${jobs_active.length - 6} more\n`
  }

  // Pending supplies
  text += `\n🛒 <b>Pending Supplies (${pending_supplies.length})</b>\n`
  if (pending_supplies.length === 0) {
    text += `No pending supply requests\n`
  } else {
    pending_supplies.slice(0, 5).forEach(s => {
      text += `• ${s.quantity}x ${s.item_name}${s.job_name ? ` (${s.job_name})` : ''}\n`
    })
    if (pending_supplies.length > 5) text += `• ...and ${pending_supplies.length - 5} more\n`
  }

  // Overdue invoices
  text += `\n💸 <b>Overdue Invoices (${overdue_invoices.length})</b>\n`
  if (overdue_invoices.length === 0) {
    text += `No overdue invoices ✓\n`
  } else {
    let totalCents = 0
    overdue_invoices.slice(0, 5).forEach(inv => {
      totalCents += inv.balance_cents
      const dollars = (inv.balance_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      text += `• #${inv.invoice_number} ${inv.client} — ${dollars} (${inv.days_overdue}d)\n`
    })
    text += `Total: <b>${(totalCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</b>\n`
  }

  // New leads from yesterday
  text += `\n🟢 <b>New Leads Yesterday (${new_leads.length})</b>\n`
  if (new_leads.length === 0) {
    text += `No new leads yesterday\n`
  } else {
    new_leads.forEach(l => { text += `• ${l.name}${l.service_type ? ` — ${l.service_type}` : ''}\n` })
  }

  // Communications section
  if (communications) {
    text += `\n📞 <b>Communications Today</b>\n`
    text += `• ${communications.calls_today} call${communications.calls_today !== 1 ? 's' : ''}`
    if (communications.missed_calls > 0) text += ` (${communications.missed_calls} missed ⚠️)`
    text += `\n`
    text += `• ${communications.messages_today} message${communications.messages_today !== 1 ? 's' : ''}\n`
    if (communications.flagged_count > 0) {
      text += `• 🚨 <b>${communications.flagged_count} flagged</b> for attention\n`
      if (communications.top_flag) text += `  → ${communications.top_flag}\n`
    }
  }

  text += `\n<a href="${appUrl}">Open Dashboard →</a>`
  await sendMessage(MGMT_CHAT, text)
}
