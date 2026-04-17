import { NextRequest, NextResponse } from 'next/server'

// POST /api/telegram/setup — register webhook URL with Telegram
export async function POST(request: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL not set' }, { status: 500 })
  }

  const webhookUrl = `${appUrl}/api/telegram/webhook`

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'channel_post'],
    }),
  })

  const data = await res.json()

  if (!data.ok) {
    return NextResponse.json({ error: data.description || 'Telegram API error', raw: data }, { status: 502 })
  }

  // Also fetch current webhook info for confirmation
  const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
  const info = await infoRes.json()

  return NextResponse.json({
    ok: true,
    webhook_url: webhookUrl,
    telegram_response: data,
    webhook_info: info.result,
  })
}

// GET /api/telegram/setup — check current webhook status
export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
  const data = await res.json()

  return NextResponse.json({
    ok: data.ok,
    webhook_info: data.result,
  })
}
