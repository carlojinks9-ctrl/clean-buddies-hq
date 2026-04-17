import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import {
  jobberQuery,
  refreshJobberToken,
  JOBS_QUERY,
  CLIENTS_QUERY,
  INVOICES_QUERY,
  mapJobberJobStatus,
  mapJobberInvoiceStatus,
} from '@/lib/jobber'
import { BURDENED_LABOR_RATE } from '@/lib/constants'
import { grossMargin } from '@/lib/margin'

export async function POST() {
  const db = createServerClient()

  // ── Fetch stored token ───────────────────────────────────────────────────
  const { data: tokenRow } = await db
    .from('integration_tokens')
    .select('*')
    .eq('service', 'jobber')
    .single()

  if (!tokenRow) {
    return NextResponse.json({ error: 'Jobber not connected' }, { status: 400 })
  }

  let accessToken = tokenRow.access_token

  // ── Refresh if expired (with 60s buffer) ─────────────────────────────────
  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() - 60_000 < Date.now()) {
    if (!tokenRow.refresh_token) {
      console.error('[sync/jobber] refresh_token is NULL in integration_tokens — must reconnect')
      return NextResponse.json({
        error: 'Jobber token expired and no refresh token stored. Go to Settings → Disconnect Jobber → Connect again to get fresh tokens.',
        disconnect_required: true,
      }, { status: 400 })
    }
    console.log('[sync/jobber] Access token expired, refreshing...')
    try {
      const refreshed = await refreshJobberToken(tokenRow.refresh_token)
      console.log('[sync/jobber] Token refresh response keys:', Object.keys(refreshed))
      accessToken = refreshed.access_token
      const expiresIn = typeof (refreshed as any).expires_in === 'number' && (refreshed as any).expires_in > 0
        ? (refreshed as any).expires_in
        : 7200
      await db.from('integration_tokens').update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? tokenRow.refresh_token,
        expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      }).eq('service', 'jobber')
      console.log('[sync/jobber] Token refreshed and saved, expires in', expiresIn, 's')
    } catch (err) {
      console.error('[sync/jobber] Token refresh FAILED:', String(err))
      return NextResponse.json({
        error: 'Token refresh failed — you may need to disconnect and reconnect Jobber in Settings.',
        detail: String(err),
        disconnect_required: true,
      }, { status: 500 })
    }
  }

  const results = { clients: 0, jobs: 0, invoices: 0, errors: [] as string[] }

  // ── Sync clients ─────────────────────────────────────────────────────────
  try {
    let cursor: string | null = null
    do {
      const data: any = await jobberQuery(accessToken, CLIENTS_QUERY, { cursor })
      console.log('[sync/jobber] clients page:', JSON.stringify(data).slice(0, 500))
      const nodes = data.clients?.nodes || []
      cursor = data.clients?.pageInfo?.hasNextPage ? data.clients.pageInfo.endCursor : null

      for (const c of nodes) {
        // phones is an array of { number } objects — take the first one
        const phone = Array.isArray(c.phones) && c.phones.length > 0
          ? c.phones[0].number
          : (c.phone || null)

        const { error } = await db.from('clients').upsert({
          jobber_id: c.id,
          name: c.name,
          company_name: c.companyName || null,
          email: c.email || null,
          phone: phone || null,
          is_gc: c.isCompany || false,
        }, { onConflict: 'jobber_id' })
        if (!error) results.clients++
      }
    } while (cursor)
  } catch (err) {
    console.error('[sync/jobber] Clients error:', err)
    results.errors.push(`Clients: ${err}`)
  }

  // ── Sync jobs ─────────────────────────────────────────────────────────────
  try {
    let cursor: string | null = null
    do {
      const data: any = await jobberQuery(accessToken, JOBS_QUERY, { cursor })
      console.log('[sync/jobber] jobs page:', JSON.stringify(data).slice(0, 500))
      const nodes = data.jobs?.nodes || []
      cursor = data.jobs?.pageInfo?.hasNextPage ? data.jobs.pageInfo.endCursor : null

      for (const j of nodes) {
        // Burdened labor from timesheets (finalDuration is in seconds)
        const totalHours = (j.timesheetEntries?.nodes || []).reduce(
          (sum: number, entry: any) => sum + (entry.finalDuration || 0) / 3600,
          0
        )
        const laborCents = Math.round(totalHours * BURDENED_LABOR_RATE * 100)
        const revenueCents = Math.round((j.total?.value || 0) * 100)
        const margin = grossMargin(revenueCents, laborCents)

        const { data: client } = await db
          .from('clients')
          .select('id')
          .eq('jobber_id', j.client?.id)
          .single()

        if (client) {
          const { error } = await db.from('jobs').upsert({
            jobber_id: j.id,
            title: j.title,
            job_number: j.jobNumber || null,
            client_id: client.id,
            status: mapJobberJobStatus(j.jobStatus || ''),
            contract_value_cents: revenueCents,
            burdened_labor_cents: laborCents,
            total_hours: totalHours,
            gross_margin: margin,
            start_date: j.startAt || j.createdAt || null,
            end_date: j.endAt || null,
          }, { onConflict: 'jobber_id' })
          if (!error) results.jobs++
        }
      }
    } while (cursor)
  } catch (err) {
    console.error('[sync/jobber] Jobs error:', err)
    results.errors.push(`Jobs: ${err}`)
  }

  // ── Sync invoices ─────────────────────────────────────────────────────────
  try {
    let cursor: string | null = null
    do {
      const data: any = await jobberQuery(accessToken, INVOICES_QUERY, { cursor })
      console.log('[sync/jobber] invoices page:', JSON.stringify(data).slice(0, 500))
      const nodes = data.invoices?.nodes || []
      cursor = data.invoices?.pageInfo?.hasNextPage ? data.invoices.pageInfo.endCursor : null

      for (const inv of nodes) {
        const amountCents = Math.round((inv.total?.value || 0) * 100)
        const balanceCents = Math.round((inv.balance?.value || 0) * 100)
        const status = mapJobberInvoiceStatus(inv.status, inv.dueDate)

        // Resolve FK: client
        const { data: client } = await db
          .from('clients')
          .select('id')
          .eq('jobber_id', inv.client?.id)
          .single()

        // Resolve FK: job (optional — invoices can exist without a linked job)
        let jobId: string | null = null
        if (inv.job?.id) {
          const { data: job } = await db
            .from('jobs')
            .select('id')
            .eq('jobber_id', inv.job.id)
            .single()
          jobId = job?.id ?? null
        }

        if (client) {
          const { error } = await db.from('invoices').upsert({
            jobber_id: inv.id,
            invoice_number: inv.invoiceNumber || null,
            client_id: client.id,
            job_id: jobId,
            amount_cents: amountCents,
            balance_cents: balanceCents,
            status,
            issue_date: inv.issuedDate || null,
            due_date: inv.dueDate || null,
            paid_date: status === 'paid' ? (inv.paidDate || null) : null,
          }, { onConflict: 'jobber_id' })
          if (!error) results.invoices++
        }
      }
    } while (cursor)
  } catch (err) {
    console.error('[sync/jobber] Invoices error:', err)
    results.errors.push(`Invoices: ${err}`)
  }

  // ── Record sync timestamp ─────────────────────────────────────────────────
  const syncedAt = new Date().toISOString()
  await db.from('app_settings').upsert(
    { key: 'last_jobber_sync', value: syncedAt, description: 'Last successful Jobber sync' },
    { onConflict: 'key' }
  )

  return NextResponse.json({
    success: true,
    synced: results,
    synced_at: syncedAt,
  })
}
