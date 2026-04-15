import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { notifyNewLead } from '@/lib/telegram'

export async function POST(request: NextRequest) {
  // Optional: validate a shared secret header
  const secret = request.headers.get('x-webhook-secret')
  if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, string>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { name, email, phone, service_type, address, message, company } = body

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  try {
    const db = createServerClient()
    const { data: lead, error } = await db
      .from('leads')
      .insert({
        name,
        email: email || null,
        phone: phone || null,
        company: company || null,
        address: address || null,
        service_type: service_type || null,
        message: message || null,
        status: 'new',
        source: 'website',
      })
      .select()
      .single()

    if (error) throw error

    // Log to activity feed
    await db.from('activity_feed').insert({
      event_type: 'new_lead',
      title: `New lead from website: ${name}`,
      description: service_type || message || '',
      lead_id: lead.id,
    })

    // Notify management via Telegram
    await notifyNewLead({ name, email: email || '', phone: phone || '', service_type: service_type || '', address: address || '', message: message || '' })

    return NextResponse.json({ success: true, lead_id: lead.id }, { status: 201 })
  } catch (err) {
    console.error('Lead webhook error:', err)
    return NextResponse.json({ error: 'Failed to create lead' }, { status: 500 })
  }
}
