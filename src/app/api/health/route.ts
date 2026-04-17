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
      ]),
    ])

    const tokenMap = new Map((tokensRes.data || []).map(t => [t.service, t]))
    const settingsMap = new Map((settingsRes.data || []).map(s => [s.key, s.value]))

    const jobberToken = tokenMap.get('jobber')
    const jobberExpired = jobberToken?.expires_at
      ? new Date(jobberToken.expires_at).getTime() < Date.now()
      : null

    const [clientsR, jobsR, invoicesR, leadsR, quoCallsR, quoMsgsR, employeesR, tasksR, suppliesR] = counts

    // Check env vars server-side only — never expose values
    const env = {
      JOBBER_CLIENT_ID: !!process.env.JOBBER_CLIENT_ID,
      JOBBER_CLIENT_SECRET: !!process.env.JOBBER_CLIENT_SECRET,
      QUO_API_KEY: !!process.env.QUO_API_KEY,
      TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_MANAGEMENT_CHAT_ID: !!(process.env.TELEGRAM_MANAGEMENT_CHAT_ID || settingsMap.get('telegram_management_chat_id')),
      GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: !!process.env.VAPID_PRIVATE_KEY,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
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
        telegram: {
          token_set: env.TELEGRAM_BOT_TOKEN,
          mgmt_chat_configured: env.TELEGRAM_MANAGEMENT_CHAT_ID,
          last_digest: settingsMap.get('last_telegram_digest') || null,
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
      },
      env,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
