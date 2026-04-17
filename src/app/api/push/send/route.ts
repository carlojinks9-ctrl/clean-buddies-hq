import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import webpush from 'web-push'

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:info@getcleanbuddies.com'

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey)
}

export async function POST(request: NextRequest) {
  if (!vapidPublicKey || !vapidPrivateKey) {
    return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 500 })
  }

  const { title, message, priority = 'medium', link = '/', emails } = await request.json()
  if (!title) return NextResponse.json({ error: 'Missing title' }, { status: 400 })

  const db = createServerClient()

  let query = db.from('push_subscriptions').select('subscription, user_email')
  if (emails?.length) {
    query = query.in('user_email', emails)
  }
  const { data: subs } = await query

  if (!subs || subs.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: 'No subscriptions found' })
  }

  const payload = JSON.stringify({ title, message, priority, link })
  let sent = 0
  const staleEndpoints: string[] = []

  await Promise.allSettled(
    subs.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription as webpush.PushSubscription, payload)
        sent++
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          staleEndpoints.push((row.subscription as any).endpoint)
        } else {
          console.error('[push/send] Push error:', err.statusCode, err.message)
        }
      }
    })
  )

  // Clean up expired subscriptions
  if (staleEndpoints.length > 0) {
    for (const endpoint of staleEndpoints) {
      try {
        await db.from('push_subscriptions')
          .delete()
          .filter('subscription->>endpoint', 'eq', endpoint)
      } catch { /* non-fatal */ }
    }
  }

  return NextResponse.json({ ok: true, sent, total: subs.length })
}
