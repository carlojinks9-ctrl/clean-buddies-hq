import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const { subscription, email } = await request.json()
    if (!subscription || !email) {
      return NextResponse.json({ error: 'Missing subscription or email' }, { status: 400 })
    }

    const db = createServerClient()

    // Insert subscription (ignore duplicate endpoint errors)
    const { error } = await db.from('push_subscriptions').insert({
      user_email: email,
      subscription,
      user_agent: request.headers.get('user-agent') || null,
    })

    if (error) {
      console.error('[push/subscribe] DB error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[push/subscribe] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
