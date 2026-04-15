import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { sendFlaggedMessage } from '@/lib/telegram'

// Flag keyword categories
const FLAG_PATTERNS = {
  safety: {
    severity: 'high' as const,
    keywords: ['hurt', 'injury', 'injured', 'accident', 'hospital', 'unsafe', 'hazard', 'emergency', 'help me'],
  },
  vehicle: {
    severity: 'high' as const,
    keywords: ['flat tire', 'breakdown', 'car accident', 'truck broke', 'van broke'],
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
    keywords: ['supply', 'need more', 'running low', 'order more'],
  },
  urgency: {
    severity: 'medium' as const,
    keywords: ['asap', 'urgent', 'immediately'],
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

function parseSupplyCommand(text: string): { item: string; quantity: string; jobName: string } | null {
  // /supply [item] [qty] [job name]
  const match = text.match(/^\/supply\s+(.+?)\s+(\d+)\s+(.+)$/i)
  if (!match) {
    // Simpler: /supply [item]
    const simple = text.match(/^\/supply\s+(.+)$/i)
    if (simple) return { item: simple[1].trim(), quantity: '1', jobName: '' }
    return null
  }
  return { item: match[1].trim(), quantity: match[2], jobName: match[3].trim() }
}

export async function POST(request: NextRequest) {
  let update: Record<string, unknown>
  try {
    update = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const message = (update.message || update.channel_post) as Record<string, unknown> | undefined
  if (!message) return NextResponse.json({ ok: true })

  const text = String(message.text || '')
  const from = message.from as Record<string, unknown> | undefined
  const chat = message.chat as Record<string, unknown> | undefined
  const senderName = from ? `${from.first_name || ''} ${from.last_name || ''}`.trim() : 'Unknown'
  const chatTitle = String(chat?.title || chat?.username || 'Direct Message')
  const crewChatId = process.env.TELEGRAM_CREW_CHAT_ID

  const db = createServerClient()

  // Command handler
  if (text.startsWith('/supply')) {
    const parsed = parseSupplyCommand(text)
    if (parsed) {
      await db.from('supply_requests').insert({
        item_name: parsed.item,
        quantity: parseInt(parsed.quantity),
        job_name: parsed.jobName || null,
        requested_by: senderName,
        priority: 'medium',
        status: 'pending',
        telegram_message_id: String(message.message_id || ''),
      })
    }
    return NextResponse.json({ ok: true })
  }

  // Monitor crew chat for flagged messages
  if (crewChatId && String(chat?.id) === crewChatId && text) {
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
