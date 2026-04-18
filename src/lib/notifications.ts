/**
 * Central notification dispatcher for Clean Buddies HQ.
 * Routes notifications to the right channel based on priority.
 *
 * Priority → Channels:
 *   urgent  → Telegram DM + management chat + web push + dashboard
 *   high    → Telegram management chat + web push + dashboard
 *   medium  → web push + dashboard
 *   low     → dashboard only
 */

import { createServerClient } from '@/lib/supabase'
import webpush from 'web-push'

// Configure VAPID (set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL in env)
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:info@getcleanbuddies.com'

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey)
}

// ── Types ──────────────────────────────────────────────────────────────────

export type NotificationPriority = 'low' | 'medium' | 'high' | 'urgent'
export type NotificationRecipient = 'carlo' | 'jorden' | 'both'

export interface NotificationInput {
  type: string
  title: string
  message: string
  priority: NotificationPriority
  recipient: NotificationRecipient
  link_to?: string
  metadata?: Record<string, unknown>
}

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

// ── Helpers ────────────────────────────────────────────────────────────────

async function sendTelegramMessage(chatId: string, text: string) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
  } catch (err) {
    console.error('[notifications] Telegram send failed:', err)
  }
}

function priorityEmoji(priority: NotificationPriority): string {
  return { urgent: '🔴', high: '🟡', medium: '🔵', low: '⚪' }[priority]
}

async function sendWebPush(
  db: ReturnType<typeof createServerClient>,
  recipient: NotificationRecipient,
  payload: { title: string; message: string; priority: string; link: string }
) {
  if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn('[notifications] VAPID keys not set — skipping web push')
    return
  }

  // Determine which email addresses to target
  const emailsToNotify: string[] = []
  const carloEmail = process.env.CARLO_EMAIL || 'info@getcleanbuddies.com'
  const jordenEmail = process.env.JORDEN_EMAIL || 'info@getcleanbuddies.com'

  if (recipient === 'carlo' || recipient === 'both') emailsToNotify.push(carloEmail)
  if (recipient === 'jorden' || recipient === 'both') emailsToNotify.push(jordenEmail)

  if (emailsToNotify.length === 0) return

  const { data: subs } = await db
    .from('push_subscriptions')
    .select('subscription')
    .in('user_email', emailsToNotify)

  if (!subs || subs.length === 0) return

  const payloadStr = JSON.stringify(payload)

  await Promise.all(
    subs.map(async (row) => {
      try {
        await webpush.sendNotification(
          row.subscription as webpush.PushSubscription,
          payloadStr
        )
      } catch (err: any) {
        // 410 Gone = subscription expired — remove it
        if (err.statusCode === 410) {
          try {
            await db
              .from('push_subscriptions')
              .delete()
              .filter('subscription->>endpoint', 'eq', (row.subscription as any).endpoint)
          } catch { /* non-fatal */ }
        } else {
          console.error('[notifications] Push send error:', err.statusCode, err.message)
        }
      }
    })
  )
}

// ── Main dispatcher ────────────────────────────────────────────────────────

export async function dispatch(input: NotificationInput): Promise<void> {
  const db = createServerClient()
  const { type, title, message, priority, recipient, link_to, metadata } = input
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

  // 1. Always store in notifications table
  await db.from('notifications').insert({
    type,
    title,
    message,
    priority,
    recipient,
    channel: priority === 'low' ? 'dashboard' : 'all',
    link_to: link_to || null,
    metadata: metadata || null,
  })

  // 2. Add to activity feed for dashboard visibility
  try {
    await db.from('activity_feed').insert({
      event_type: `notification_${type}`,
      title,
      description: message,
      metadata: { priority, recipient, link_to },
    })
  } catch { /* non-fatal */ }

  const emoji = priorityEmoji(priority)
  const telegramText = `${emoji} <b>${title}</b>\n\n${message}${link_to ? `\n\n<a href="${appUrl}${link_to}">View →</a>` : ''}`

  // 3. Route by priority
  if (priority === 'urgent') {
    // → Telegram management chat + DMs
    const mgmtChat = process.env.TELEGRAM_MANAGEMENT_CHAT_ID || '-5218394283'
    if (mgmtChat) await sendTelegramMessage(mgmtChat, telegramText)

    // → DMs to specific people
    if (recipient === 'carlo' || recipient === 'both') {
      const carloId = process.env.TELEGRAM_CARLO_USER_ID
      if (carloId) await sendTelegramMessage(carloId, telegramText)
    }
    if (recipient === 'jorden' || recipient === 'both') {
      const jordenId = process.env.TELEGRAM_JORDEN_USER_ID
      if (jordenId) await sendTelegramMessage(jordenId, telegramText)
    }

    // → Web push
    await sendWebPush(db, recipient, { title, message, priority, link: link_to || '/' })
  }

  if (priority === 'high') {
    // → Telegram management chat
    const mgmtChat = process.env.TELEGRAM_MANAGEMENT_CHAT_ID || '-5218394283'
    if (mgmtChat) await sendTelegramMessage(mgmtChat, telegramText)

    // → Web push
    await sendWebPush(db, recipient, { title, message, priority, link: link_to || '/' })
  }

  if (priority === 'medium') {
    // → Web push only (no Telegram for medium)
    await sendWebPush(db, recipient, { title, message, priority, link: link_to || '/' })
  }

  // low → dashboard only (already inserted above)
}

/** Dispatch multiple notifications concurrently */
export async function dispatchMany(notifications: NotificationInput[]): Promise<void> {
  await Promise.allSettled(notifications.map(n => dispatch(n)))
}

/** Check quiet hours (no urgent/high notifications between 9pm–7am AZ time) */
export function isQuietHours(): boolean {
  const azNow = new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' })
  const hour = new Date(azNow).getHours()
  return hour >= 21 || hour < 7
}
