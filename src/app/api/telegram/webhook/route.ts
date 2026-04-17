import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { sendFlaggedMessage, replyToMessage, notifySupplyRequest } from '@/lib/telegram'

// ── Flag keyword categories ──────────────────────────────────────────────────

const FLAG_PATTERNS = {
  safety: {
    severity: 'high' as const,
    keywords: ['hurt', 'injury', 'injured', 'accident', 'hospital', 'unsafe', 'hazard', 'emergency', 'help me'],
  },
  vehicle: {
    severity: 'high' as const,
    keywords: ['flat tire', 'breakdown', 'car accident', 'truck broke', 'van broke'],
  },
  urgency: {
    severity: 'high' as const,
    keywords: ['asap', 'urgent', 'immediately'],
  },
  schedule: {
    severity: 'medium' as const,
    keywords: ["can't make it", "cant make it", 'running late', 'no show', 'sick', 'call out', 'calling out'],
  },
  equipment: {
    severity: 'medium' as const,
    keywords: ['broken', 'out of', 'ran out', 'need supplies', 'equipment', 'machine broke', 'vacuum broke'],
  },
  customer: {
    severity: 'medium' as const,
    keywords: ['client', 'customer', 'complaint', 'unhappy', 'problem with', 'not happy'],
  },
  supply: {
    severity: 'low' as const,
    keywords: ['supply', 'need more', 'running low', 'order more', 'restock'],
  },
}

function checkMessage(text: string): { category: string; severity: 'high' | 'medium' | 'low' } | null {
  const lower = text.toLowerCase()
  for (const [category, { severity, keywords }] of Object.entries(FLAG_PATTERNS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return { category, severity }
    }
  }
  return null
}

// /supply [item] [qty] [job name]  OR  /supply [item]
function parseSupplyCommand(text: string): { item: string; quantity: string; jobName: string } | null {
  const match = text.match(/^\/supply\s+(.+?)\s+(\d+)\s+(.+)$/i)
  if (match) return { item: match[1].trim(), quantity: match[2], jobName: match[3].trim() }
  const simple = text.match(/^\/supply\s+(.+)$/i)
  if (simple) return { item: simple[1].trim(), quantity: '1', jobName: '' }
  return null
}

function homeDepotUrl(item: string) {
  return `https://www.homedepot.com/s/${encodeURIComponent(item)}`
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let update: Record<string, unknown>
  try {
    update = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const message = (update.message || update.channel_post) as Record<string, unknown> | undefined
  if (!message) return NextResponse.json({ ok: true })

  const text = String(message.text || '').trim()
  const from = message.from as Record<string, unknown> | undefined
  const chat = message.chat as Record<string, unknown> | undefined
  const messageId = Number(message.message_id)
  const chatId = String(chat?.id || '')
  const chatType = String(chat?.type || '')
  const chatTitle = String(chat?.title || chat?.username || 'Direct Message')
  const senderName = from
    ? `${from.first_name || ''} ${from.last_name || ''}`.trim() || String(from.username || 'Unknown')
    : 'Unknown'

  const db = createServerClient()
  const crewChatId = process.env.TELEGRAM_CREW_CHAT_ID

  // ── Log group chat IDs to activity_feed so we can discover them ──────────
  if (chatType === 'group' || chatType === 'supergroup') {
    console.log(`[Telegram] Group message — chat_id: ${chatId}, title: "${chatTitle}", type: ${chatType}`)

    // Only insert once per chat (upsert-style: skip if already logged recently)
    await db.from('activity_feed').insert({
      event_type: 'telegram_chat_detected',
      title: `Telegram group detected: ${chatTitle}`,
      description: `chat_id: ${chatId}`,
      metadata: { chat_id: chatId, chat_title: chatTitle, chat_type: chatType, sender: senderName },
    })
  }

  // ── /help ─────────────────────────────────────────────────────────────────
  if (text === '/help' || text.startsWith('/help@')) {
    await replyToMessage(chatId, messageId,
      `🤖 <b>CB Assistant — Commands</b>\n\n` +
      `📦 <b>/supply [item] [qty] [job]</b>\n` +
      `   Log a supply request\n` +
      `   <i>Example: /supply Windex 4 Lanai Living</i>\n\n` +
      `📊 <b>/status</b> — Today's snapshot\n` +
      `💸 <b>/ar</b> — Outstanding AR summary\n` +
      `❓ <b>/help</b> — Show this message`
    )
    return NextResponse.json({ ok: true })
  }

  // ── /supply ───────────────────────────────────────────────────────────────
  if (text.startsWith('/supply')) {
    const parsed = parseSupplyCommand(text)
    if (!parsed) {
      await replyToMessage(chatId, messageId,
        `❌ Usage: <code>/supply [item] [quantity] [job name]</code>\n` +
        `Example: <code>/supply Windex 4 Lanai Living</code>`
      )
      return NextResponse.json({ ok: true })
    }

    const hdUrl = homeDepotUrl(parsed.item)

    await db.from('supply_requests').insert({
      item_name: parsed.item,
      quantity: parseInt(parsed.quantity),
      job_name: parsed.jobName || null,
      requested_by: senderName,
      priority: 'medium',
      status: 'pending',
      home_depot_url: hdUrl,
      telegram_message_id: String(messageId),
    })

    // Confirm to the crew chat
    await replyToMessage(chatId, messageId,
      `✅ <b>Added:</b> ${parsed.quantity}x ${parsed.item}${parsed.jobName ? ` for ${parsed.jobName}` : ''}\n` +
      `Management has been notified.`
    )

    // Notify management
    await notifySupplyRequest({
      item: parsed.item,
      quantity: parsed.quantity,
      job_name: parsed.jobName,
      requested_by: senderName,
      home_depot_url: hdUrl,
    })

    return NextResponse.json({ ok: true })
  }

  // ── /status ───────────────────────────────────────────────────────────────
  if (text === '/status' || text.startsWith('/status@')) {
    const [jobsRes, suppliesRes, leadsRes] = await Promise.all([
      db.from('jobs').select('id', { count: 'exact', head: true }).in('status', ['active', 'scheduled']),
      db.from('supply_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    ])

    const activeJobs = jobsRes.count ?? 0
    const pendingSupplies = suppliesRes.count ?? 0
    const newLeads = leadsRes.count ?? 0
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

    await replyToMessage(chatId, messageId,
      `📊 <b>CB Status Snapshot</b>\n\n` +
      `🟢 Active/Scheduled Jobs: <b>${activeJobs}</b>\n` +
      `🛒 Pending Supply Requests: <b>${pendingSupplies}</b>\n` +
      `📥 New Leads: <b>${newLeads}</b>\n\n` +
      `<a href="${appUrl}">Open Dashboard →</a>`
    )
    return NextResponse.json({ ok: true })
  }

  // ── /ar ───────────────────────────────────────────────────────────────────
  if (text === '/ar' || text.startsWith('/ar@')) {
    const { data: overdueInvoices } = await db
      .from('invoices')
      .select('invoice_number, balance_cents, due_date')
      .eq('status', 'overdue')
      .order('due_date', { ascending: true })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

    if (!overdueInvoices || overdueInvoices.length === 0) {
      await replyToMessage(chatId, messageId,
        `💸 <b>AR Summary</b>\n\nNo overdue invoices ✓\n\n<a href="${appUrl}/financials">View Financials →</a>`
      )
    } else {
      const totalCents = overdueInvoices.reduce((sum: number, inv: any) => sum + (inv.balance_cents || 0), 0)
      const today = new Date()
      let lines = overdueInvoices.slice(0, 8).map((inv: any) => {
        const due = new Date(inv.due_date)
        const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86400000)
        const dollars = ((inv.balance_cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
        return `• #${inv.invoice_number} — ${dollars} (${daysOverdue}d overdue)`
      }).join('\n')

      const totalDollars = (totalCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      await replyToMessage(chatId, messageId,
        `💸 <b>AR Summary — ${overdueInvoices.length} Overdue</b>\n\n` +
        `${lines}\n\n` +
        `<b>Total Outstanding: ${totalDollars}</b>\n\n` +
        `<a href="${appUrl}/financials">View AR Aging →</a>`
      )
    }
    return NextResponse.json({ ok: true })
  }

  // ── Crew chat monitoring ───────────────────────────────────────────────────
  if (crewChatId && chatId === crewChatId && text && !text.startsWith('/')) {
    const flag = checkMessage(text)
    if (flag) {
      await sendFlaggedMessage({
        original_text: text,
        sender_name: senderName,
        severity: flag.severity,
        category: flag.category,
        chat_title: chatTitle,
      })
    }
  }

  return NextResponse.json({ ok: true })
}
