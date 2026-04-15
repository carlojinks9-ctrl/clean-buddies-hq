import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { notifyInvoicePaid, notifyJobStatusChange, notifyNewLead } from '@/lib/telegram'
import crypto from 'crypto'

function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(body)
  const expected = hmac.digest('hex')
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-jobber-hmac-sha256') || ''

  // In production, verify HMAC — skip in dev if no webhook secret set
  if (process.env.JOBBER_WEBHOOK_SECRET && signature) {
    const valid = verifyWebhookSignature(rawBody, signature, process.env.JOBBER_WEBHOOK_SECRET)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { topic, data } = payload as { topic: string; data: Record<string, unknown> }
  const db = createServerClient()

  try {
    switch (topic) {
      case 'JOB_CREATE':
      case 'JOB_UPDATE': {
        await db.from('activity_feed').insert({
          event_type: topic === 'JOB_CREATE' ? 'job_created' : 'job_updated',
          title: `Job ${topic === 'JOB_CREATE' ? 'created' : 'updated'}: ${data.title || 'Unknown'}`,
          metadata: data,
        })
        if (data.status) {
          await notifyJobStatusChange({
            title: String(data.title || ''),
            client_name: String(data.client_name || ''),
            status: String(data.status || ''),
            job_id: String(data.id || ''),
          })
        }
        break
      }

      case 'INVOICE_CREATE': {
        await db.from('activity_feed').insert({
          event_type: 'invoice_created',
          title: `Invoice created: #${data.invoice_number}`,
          metadata: data,
        })
        break
      }

      case 'INVOICE_PAID': {
        await db.from('activity_feed').insert({
          event_type: 'invoice_paid',
          title: `Invoice paid: #${data.invoice_number}`,
          description: `${data.client_name} — $${Number(data.total) / 100}`,
          metadata: data,
        })
        await notifyInvoicePaid({
          invoice_number: String(data.invoice_number || ''),
          client_name: String(data.client_name || ''),
          amount_cents: Number(data.total || 0),
        })
        break
      }

      case 'CLIENT_CREATE': {
        await db.from('activity_feed').insert({
          event_type: 'client_created',
          title: `New client: ${data.name || data.company_name}`,
          metadata: data,
        })
        break
      }

      case 'VISIT_COMPLETE': {
        await db.from('activity_feed').insert({
          event_type: 'visit_complete',
          title: `Visit completed`,
          metadata: data,
        })
        break
      }
    }
  } catch (err) {
    console.error('Jobber webhook handler error:', err)
  }

  return NextResponse.json({ received: true })
}
