import { NextRequest, NextResponse } from 'next/server'
import { listWebhooks, registerWebhook, deleteWebhook, QUO_WEBHOOK_EVENTS } from '@/lib/quo'

// POST — register webhook, GET — list current webhooks
export async function POST(request: NextRequest) {
  const apiKey = process.env.QUO_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'QUO_API_KEY not set' }, { status: 500 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL not set' }, { status: 500 })

  const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/quo/webhook`

  try {
    // Remove any existing webhooks pointing to our URL to avoid duplicates
    const existing = await listWebhooks()
    const ours = existing.filter(w => w.url === webhookUrl)
    await Promise.all(ours.map(w => deleteWebhook(w.id).catch(() => {})))

    // Register fresh
    const webhook = await registerWebhook(webhookUrl, QUO_WEBHOOK_EVENTS)

    return NextResponse.json({
      ok: true,
      webhook_url: webhookUrl,
      webhook_id: webhook.id,
      events: QUO_WEBHOOK_EVENTS,
    })
  } catch (err) {
    console.error('[quo/setup] Register error:', err)
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}

export async function GET() {
  const apiKey = process.env.QUO_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'QUO_API_KEY not set' }, { status: 500 })

  try {
    const webhooks = await listWebhooks()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const ours = webhooks.filter(w => w.url?.includes(appUrl.replace(/https?:\/\//, '')))
    return NextResponse.json({ ok: true, webhooks: ours, all: webhooks })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}
