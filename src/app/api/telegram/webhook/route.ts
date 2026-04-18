import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { sendFlaggedMessage, replyToMessage, notifySupplyRequest, MGMT_CHAT_ID, CREW_CHAT_ID } from '@/lib/telegram'

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

// Unit words recognised after a quantity number
const UNIT_WORDS = new Set([
  'bottle', 'bottles', 'roll', 'rolls', 'box', 'boxes', 'case', 'cases',
  'pack', 'packs', 'can', 'cans', 'bag', 'bags', 'gallon', 'gallons',
  'each', 'pair', 'pairs', 'set', 'sets', 'tube', 'tubes', 'sheet', 'sheets',
  'bucket', 'buckets', 'jug', 'jugs', 'spray', 'sprays', 'pad', 'pads',
])

interface ParsedSupply {
  item: string
  quantity: number
  unit: string
  jobName: string
  urgency: number | null
}

/**
 * Flexible /supply parser.
 * Examples that must work:
 *   /supply pink stuff 1 bottle
 *   /supply ram board 5 rolls
 *   /supply glass cleaner 2 bottles lanai building 5 3
 *   /supply trash bags 1 box model home 2
 */
function parseSupplyCommand(text: string): ParsedSupply | null {
  const body = text.replace(/^\/supply\s*/i, '').trim()
  if (!body) return null

  const tokens = body.split(/\s+/)

  // Pop urgency if last token is a single digit 1–3
  let urgency: number | null = null
  if (tokens.length > 1 && /^[1-3]$/.test(tokens[tokens.length - 1])) {
    urgency = parseInt(tokens.pop()!, 10)
  }

  // Find quantity phrase: a number (optionally followed by a unit word)
  let qtyIndex = -1
  let qtyNum = 1
  let qtyUnit = ''

  for (let i = 0; i < tokens.length; i++) {
    if (/^\d+$/.test(tokens[i]) && i > 0) {
      const nextWord = tokens[i + 1]?.toLowerCase() ?? ''
      if (UNIT_WORDS.has(nextWord)) {
        qtyIndex = i
        qtyNum = parseInt(tokens[i], 10)
        qtyUnit = tokens[i + 1]
        break
      } else {
        // bare number with no unit — only treat as qty if there's an item before it
        qtyIndex = i
        qtyNum = parseInt(tokens[i], 10)
        qtyUnit = ''
        break
      }
    }
  }

  if (qtyIndex === -1) {
    // No quantity found — whole thing is item name, quantity=1
    return { item: tokens.join(' '), quantity: 1, unit: '', jobName: '', urgency }
  }

  const item = tokens.slice(0, qtyIndex).join(' ') || 'Unknown item'
  const afterQty = qtyUnit
    ? tokens.slice(qtyIndex + 2)
    : tokens.slice(qtyIndex + 1)
  const jobName = afterQty.join(' ')

  return { item, quantity: qtyNum, unit: qtyUnit, jobName, urgency }
}

function homeDepotUrl(item: string) {
  return `https://www.homedepot.com/s/${encodeURIComponent(item)}`
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Always return 200 so Telegram never retries — log everything
  let update: Record<string, unknown>
  try {
    const raw = await request.text()
    console.log('[Telegram] Raw webhook body:', raw.slice(0, 2000))
    update = JSON.parse(raw)
  } catch (parseErr) {
    console.error('[Telegram] Failed to parse webhook body:', parseErr)
    return NextResponse.json({ ok: true })
  }

  console.log('[Telegram] Parsed update keys:', Object.keys(update))

  const message = (update.message || update.channel_post) as Record<string, unknown> | undefined
  if (!message) {
    console.log('[Telegram] No message/channel_post in update — skipping')
    return NextResponse.json({ ok: true })
  }

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

  console.log(`[Telegram] Message — from: ${senderName}, chat: ${chatId} (${chatType}) "${chatTitle}", text: "${text.slice(0, 200)}"`)

  let db: ReturnType<typeof createServerClient>
  try {
    db = createServerClient()
  } catch (err) {
    console.error('[Telegram] createServerClient failed — SUPABASE_SERVICE_ROLE_KEY may be missing on Vercel:', err)
    return NextResponse.json({ ok: true })
  }

  const crewChatId = CREW_CHAT_ID   // uses env var with hardcoded fallback

  // ── Log group chat IDs to activity_feed AND app_settings so we can discover them ──────────
  if (chatType === 'group' || chatType === 'supergroup') {
    console.log(`[Telegram] Group message — chat_id: ${chatId}, title: "${chatTitle}", type: ${chatType}`)

    const { error: afErr } = await db.from('activity_feed').insert({
      event_type: 'telegram_chat_detected',
      title: `Telegram group detected: ${chatTitle}`,
      description: `chat_id: ${chatId}`,
      metadata: { chat_id: chatId, chat_title: chatTitle, chat_type: chatType, sender: senderName },
    })
    if (afErr) console.error('[Telegram] activity_feed insert error:', afErr)

    // Also persist to app_settings for reliable Settings page discovery
    const { error: asErr } = await db.from('app_settings').upsert({
      key: `telegram_group_${chatId}`,
      value: chatId,
      description: `Telegram group: ${chatTitle} (${chatType})`,
    }, { onConflict: 'key' })
    if (asErr) console.error('[Telegram] app_settings upsert error:', asErr)
  }

  // ── /help ─────────────────────────────────────────────────────────────────
  if (text === '/help' || text.startsWith('/help@')) {
    const isCrewChat = chatId === crewChatId

    if (isCrewChat || chatType === 'group' || chatType === 'supergroup') {
      // Crew chat — supply request instructions only, no management commands
      await replyToMessage(chatId, messageId,
        `📦 <b>Supply Request Format</b>\n\n` +
        `<code>/supply [item] [quantity + unit] [optional job name] [optional urgency]</code>\n\n` +
        `<b>Examples:</b>\n` +
        `<code>/supply pink stuff 1 bottle</code>\n` +
        `<code>/supply ram board 5 rolls</code>\n` +
        `<code>/supply trash bags 1 box model home 2</code>\n` +
        `<code>/supply glass cleaner 2 bottles lanai building 5 3</code>\n\n` +
        `<b>Urgency (optional, add at end):</b>\n` +
        `3 = ASAP / needed today\n` +
        `2 = needed this week\n` +
        `1 = low urgency / restock\n\n` +
        `Job name is optional — include it if you know which site needs it.`
      )
    } else {
      // Management / DM — full command list
      await replyToMessage(chatId, messageId,
        `🤖 <b>CB Assistant — Commands</b>\n\n` +
        `📦 <b>/supply [item] [qty + unit] [job] [urgency]</b>\n` +
        `   Log a supply request\n\n` +
        `📊 <b>/status</b> — Today's snapshot\n` +
        `💸 <b>/ar</b> — Outstanding AR summary\n` +
        `❓ <b>/help</b> — Show this message`
      )
    }
    return NextResponse.json({ ok: true })
  }

  // ── /supply ───────────────────────────────────────────────────────────────
  if (text.startsWith('/supply')) {
    const parsed = parseSupplyCommand(text)
    if (!parsed) {
      await replyToMessage(chatId, messageId,
        `❌ Usage: <code>/supply [item] [quantity] [job name]</code>\n` +
        `Example: <code>/supply pink stuff 1 bottle lanai building 5</code>`
      )
      return NextResponse.json({ ok: true })
    }

    const hdUrl = homeDepotUrl(parsed.item)
    const priorityMap: Record<number, 'low' | 'medium' | 'high'> = { 1: 'low', 2: 'medium', 3: 'high' }
    const priority = parsed.urgency ? (priorityMap[parsed.urgency] ?? 'medium') : 'medium'

    const { error: supplyErr } = await db.from('supply_requests').insert({
      item_name: parsed.item,
      quantity: parsed.quantity,
      unit: parsed.unit || null,
      job_name: parsed.jobName || null,
      requested_by: senderName,
      priority,
      status: 'pending',
      home_depot_url: hdUrl,
      telegram_message_id: String(messageId),
    })
    if (supplyErr) console.error('[Telegram] supply_requests insert error:', supplyErr)
    else console.log(`[Telegram] Supply request saved: ${parsed.quantity} ${parsed.unit} ${parsed.item}`)

    const qtyDisplay = parsed.unit ? `${parsed.quantity} ${parsed.unit}` : String(parsed.quantity)
    const urgencyDisplay = parsed.urgency ? String(parsed.urgency) : 'normal'

    // Reply in crew chat (or wherever command was sent)
    await replyToMessage(chatId, messageId,
      `✅ Supply request logged: <b>${parsed.item}</b> · ${qtyDisplay} · ${parsed.jobName || 'no job specified'} · urgency ${urgencyDisplay}`
    )

    // Notify management chat
    await notifySupplyRequest({
      item: parsed.item,
      quantity: parsed.quantity,
      unit: parsed.unit,
      job_name: parsed.jobName || null,
      requested_by: senderName,
      home_depot_url: hdUrl,
      urgency: parsed.urgency,
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
      const lines = overdueInvoices.slice(0, 8).map((inv: any) => {
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
      console.log(`[Telegram] Flagged message — severity: ${flag.severity}, category: ${flag.category}`)
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
