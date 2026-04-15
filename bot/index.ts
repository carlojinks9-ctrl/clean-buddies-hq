/**
 * Clean Buddies Telegram Bot — "CB Assistant"
 * Run with: npm run bot
 * In production, use webhook mode instead of polling.
 */

import TelegramBot from 'node-telegram-bot-api'
import { createClient } from '@supabase/supabase-js'
import { handleStatusCommand } from './handlers/status'
import { handleLeadsCommand } from './handlers/leads'
import { handleArCommand } from './handlers/ar'
import { handleMarginCommand } from './handlers/margin'
import { handleSupplyCommand } from './supply/handler'
import { monitorMessage } from './monitor/monitor'

// Load env
import * as dotenv from 'dotenv'
dotenv.config({ path: '../.env.local' })

const token = process.env.TELEGRAM_BOT_TOKEN!
const mgmtChatId = process.env.TELEGRAM_MANAGEMENT_CHAT_ID!
const crewChatId = process.env.TELEGRAM_CREW_CHAT_ID

// In development, use polling. In production, use webhooks.
const bot = new TelegramBot(token, {
  polling: process.env.NODE_ENV !== 'production',
})

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

console.log('CB Assistant bot starting...')

// ─── Commands ───────────────────────────────────

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '👋 <b>CB Assistant</b> — Clean Buddies Command Center\n\n' +
    'Commands:\n' +
    '/status — Today\'s snapshot\n' +
    '/leads — Lead pipeline\n' +
    '/ar — Outstanding AR\n' +
    '/margin [job name] — Quick margin check\n' +
    '/supply [item] [qty] [job] — Request supplies',
    { parse_mode: 'HTML' }
  )
})

bot.onText(/\/status/, async (msg) => {
  const text = await handleStatusCommand(db)
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', disable_web_page_preview: true })
})

bot.onText(/\/leads/, async (msg) => {
  const text = await handleLeadsCommand(db)
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', disable_web_page_preview: true })
})

bot.onText(/\/ar/, async (msg) => {
  const text = await handleArCommand(db)
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', disable_web_page_preview: true })
})

bot.onText(/\/margin (.+)/, async (msg, match) => {
  const jobName = match?.[1] || ''
  const text = await handleMarginCommand(db, jobName)
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' })
})

bot.onText(/\/supply (.+)/, async (msg, match) => {
  const args = match?.[1] || ''
  const senderName = `${msg.from?.first_name || ''} ${msg.from?.last_name || ''}`.trim()
  const text = await handleSupplyCommand(db, args, senderName, String(msg.message_id))
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' })

  // Notify management
  if (mgmtChatId && msg.chat.id.toString() !== mgmtChatId) {
    bot.sendMessage(mgmtChatId,
      `🛒 <b>Supply Request</b> from ${senderName}\n${text}`,
      { parse_mode: 'HTML' }
    )
  }
})

// ─── Message Monitor (crew chat) ────────────────

bot.on('message', async (msg) => {
  if (!crewChatId || msg.chat.id.toString() !== crewChatId) return
  if (!msg.text || msg.text.startsWith('/')) return

  const flagResult = await monitorMessage(
    msg.text,
    `${msg.from?.first_name || ''} ${msg.from?.last_name || ''}`.trim(),
    db
  )

  if (flagResult && mgmtChatId) {
    const severityEmoji = { high: '🔴', medium: '🟡', low: '🟢' }[flagResult.severity]
    const alertText =
      `${severityEmoji} <b>Flagged: ${flagResult.category.toUpperCase()}</b>\n\n` +
      `From: <b>${flagResult.senderName}</b>\n` +
      `<i>"${msg.text}"</i>`

    bot.sendMessage(mgmtChatId, alertText, { parse_mode: 'HTML' })
  }
})

// ─── Daily digest cron (simple interval) ────────

async function sendDailyDigest() {
  if (!mgmtChatId) return
  const statusText = await handleStatusCommand(db)
  bot.sendMessage(mgmtChatId, `🌅 <b>Daily Digest</b>\n\n${statusText}`, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
}

// Schedule daily digest at 7 AM MST (14:00 UTC)
function scheduleDailyDigest() {
  const now = new Date()
  const target = new Date()
  target.setUTCHours(14, 0, 0, 0)
  if (target <= now) target.setDate(target.getDate() + 1)
  const msUntilTarget = target.getTime() - now.getTime()
  setTimeout(() => {
    sendDailyDigest()
    setInterval(sendDailyDigest, 24 * 60 * 60 * 1000)
  }, msUntilTarget)
}

scheduleDailyDigest()

bot.on('polling_error', (err) => console.error('Polling error:', err))
console.log('Bot ready.')
