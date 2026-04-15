/**
 * Telegram notification helpers for the Clean Buddies management chat.
 * Uses the Bot API directly (no polling — webhook-driven).
 */

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
const MGMT_CHAT = process.env.TELEGRAM_MANAGEMENT_CHAT_ID

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
