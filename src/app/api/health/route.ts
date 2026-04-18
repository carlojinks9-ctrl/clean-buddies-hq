import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const db = createServerClient()

    const [tokensRes, settingsRes, counts] = await Promise.all([
      db.from('integration_tokens').select('service, expires_at, created_at, updated_at'),
      db.from('app_settings').select('key, value'),
      Promise.all([
        db.from('clients').select('id', { count: 'exact', head: true }),
        db.from('jobs').select('id', { count: 'exact', head: true }),
        db.from('invoices').select('id', { count: 'exact', head: true }),
        db.from('leads').select('id', { count: 'exact', head: true }),
        db.from('quo_calls').select('id', { count: 'exact', head: true }),
        db.from('quo_messages').select('id', { count: 'exact', head: true }),
        db.from('employees').select('id', { count: 'exact', head: true }),
        db.from('tasks').select('id', { count: 'exact', head: true }),
        db.from('supply_requests').select('id', { count: 'exact', head: true }),
        db.from('inbound_items').select('id', { count: 'exact', head: true }).eq('status', 'new'),
        db.from('ghl_submissions').select('id', { count: 'exact', head: true }),
        db.from('instantly_replies').select('id', { count: 'exact', head: true }),
        db.from('sla_breaches').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString()),
      ]),
    ])

    const tokenMap = new Map((tokensRes.data || []).map((t: Record<string, unknown>) => [t.service as string, t]))
    const settingsMap = new Map((settingsRes.data || []).map((s: Record<string, unknown>) => [s.key as string, s.value as string]))

    const jobberToken = tokenMap.get('jobber') as Record<string, string> | undefined
    const jobberExpired = jobberToken?.expires_at
      ? new Date(jobberToken.expires_at).getTime() < Date.now()
      : null

    const [clientsR, jobsR, invoicesR, leadsR, quoCallsR, quoMsgsR, employeesR, tasksR, suppliesR,
      inboundItemsR, ghlSubsR, instantlyRepliesR, slaBreachesR] = counts

    // Check env vars server-side only — never expose values
    const env = {
      JOBBER_CLIENT_ID: !!process.env.JOBBER_CLIENT_ID,
      JOBBER_CLIENT_SECRET: !!process.env.JOBBER_CLIENT_SECRET,
      JOBBER_ICAL_URL: !!process.env.JOBBER_ICAL_URL,
      QUO_API_KEY: !!process.env.QUO_API_KEY,
      QUO_WEBHOOK_SIGNING_SECRET: !!process.env.QUO_WEBHOOK_SIGNING_SECRET,
      TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_MANAGEMENT_CHAT_ID: !!(process.env.TELEGRAM_MANAGEMENT_CHAT_ID || settingsMap.get('telegram_management_chat_id')),
      GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: !!process.env.VAPID_PRIVATE_KEY,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      GHL_PRIVATE_INTEGRATION_TOKEN: !!process.env.GHL_PRIVATE_INTEGRATION_TOKEN,
      GHL_LOCATION_ID: !!process.env.GHL_LOCATION_ID,
      INSTANTLY_API_KEY: !!process.env.INSTANTLY_API_KEY,
    }

    return NextResponse.json({
      integrations: {
        jobber: {
          connected: !!jobberToken,
          token_expired: jobberExpired,
          expires_at: jobberToken?.expires_at || null,
          connected_at: jobberToken?.created_at || null,
          last_sync: settingsMap.get('last_jobber_sync') || null,
          reconnect_required: settingsMap.get('jobber_reconnect_required') === 'true',
          last_error: settingsMap.get('jobber_last_error') || null,
          env_ok: env.JOBBER_CLIENT_ID && env.JOBBER_CLIENT_SECRET,
        },
        quo: {
          api_key_set: env.QUO_API_KEY,
          last_sync: settingsMap.get('last_quo_sync') || null,
        },
        google: {
          connected: !!tokenMap.get('google'),
          last_sync: settingsMap.get('last_google_sync') || null,
          env_ok: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
        },
        jobber_ical: {
          configured: env.JOBBER_ICAL_URL,
          last_sync: settingsMap.get('last_ical_sync') || null,
        },
        telegram: {
          token_set: env.TELEGRAM_BOT_TOKEN,
          mgmt_chat_configured: env.TELEGRAM_MANAGEMENT_CHAT_ID,
          last_digest: settingsMap.get('last_telegram_digest') || null,
        },
        ghl: {
          token_set: env.GHL_PRIVATE_INTEGRATION_TOKEN,
          location_id_set: env.GHL_LOCATION_ID,
          last_sync: settingsMap.get('last_ghl_sync') || null,
          last_error: settingsMap.get('ghl_last_error') || null,
        },
        instantly: {
          api_key_set: env.INSTANTLY_API_KEY,
          last_sync: settingsMap.get('last_instantly_sync') || null,
          last_error: settingsMap.get('instantly_last_error') || null,
        },
      },
      records: {
        clients: clientsR.count ?? 0,
        jobs: jobsR.count ?? 0,
        invoices: invoicesR.count ?? 0,
        leads: leadsR.count ?? 0,
        quo_calls: quoCallsR.count ?? 0,
        quo_messages: quoMsgsR.count ?? 0,
        employees: employeesR.count ?? 0,
        tasks: tasksR.count ?? 0,
        supply_requests: suppliesR.count ?? 0,
        inbound_items_new: (inboundItemsR as { count: number | null }).count ?? 0,
        ghl_submissions: (ghlSubsR as { count: number | null }).count ?? 0,
        instantly_replies: (instantlyRepliesR as { count: number | null }).count ?? 0,
        sla_breaches_24h: (slaBreachesR as { count: number | null }).count ?? 0,
      },
      env,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
