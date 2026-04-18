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
      // Clear any stored reconnect flag since refresh succeeded
      await db.from('app_settings').upsert(
        { key: 'jobber_reconnect_required', value: 'false', description: 'Jobber reconnect required flag' },
        { onConflict: 'key' }
      )
    } catch (err) {
      const detail = String(err)
      console.error('[sync/jobber] Token refresh FAILED:', detail)
      // Persist the reconnect-required state so Settings page shows it even after reload
      try {
        await db.from('app_settings').upsert(
          { key: 'jobber_reconnect_required', value: 'true', description: 'Jobber reconnect required flag' },
          { onConflict: 'key' }
        )
        await db.from('app_settings').upsert(
          { key: 'jobber_last_error', value: detail.slice(0, 500), description: 'Last Jobber sync error' },
          { onConflict: 'key' }
        )
      } catch { /* non-fatal */ }
      return NextResponse.json({
        error: 'Token refresh failed — disconnect and reconnect Jobber in Settings → Integrations.',
        detail,
        disconnect_required: true,
      }, { status: 500 })
    }
  }

  type SyncError = {
    section: 'clients' | 'jobs' | 'invoices'
    category: 'auth' | 'graphql_schema' | 'db_write' | 'network' | 'unknown'
    message: string   // short, readable
    raw: string       // full error string for diagnosis
    hint: string
  }

  function categorizeError(raw: string, section: SyncError['section']): SyncError {
    const r = raw.toLowerCase()
    if (
      r.includes('jobber_unauthorized') ||
      r.includes('unauthenticated') ||
      r.includes('invalid token') ||
      r.includes('not authenticated') ||
      r.includes('token') && r.includes('invalid')
    ) {
      return {
        section, raw, category: 'auth',
        message: 'Token invalid or missing permissions',
        hint: 'Disconnect and reconnect Jobber in Settings to get fresh tokens.',
      }
    }
    // THROTTLED must be checked BEFORE the generic graphql_schema branch —
    // the throttle error also contains "graphql errors" and would be misclassified.
    if (r.includes('throttled') || r.includes('"code":"throttled"')) {
      return {
        section, raw, category: 'unknown',
        message: 'Jobber API rate limit hit (THROTTLED)',
        hint: 'Too many requests in quick succession. The sync will succeed if retried after a few seconds. Jobber uses a leaky-bucket rate limiter.',
      }
    }
    if (
      r.includes('graphql error') ||
      r.includes('graphql errors') ||
      r.includes("doesn't exist on type") ||
      r.includes('cannot query field') ||
      r.includes('unknown field') ||
      r.includes('field') && r.includes('does not exist') ||
      r.includes('no such field') ||
      r.includes('unknown argument') ||
      r.includes('parse error')
    ) {
      return {
        section, raw, category: 'graphql_schema',
        message: 'GraphQL query field rejected by Jobber API',
        hint: 'A field in the query does not exist in this Jobber API version. Check the raw error for the exact field name.',
      }
    }
    if (
      r.includes('duplicate key') ||
      r.includes('violates') ||
      r.includes('null value in column') ||
      r.includes('foreign key') ||
      r.includes('constraint')
    ) {
      return {
        section, raw, category: 'db_write',
        message: 'Database write/upsert constraint violation',
        hint: 'A record from Jobber failed to insert due to a schema constraint. Check the raw error for the column name.',
      }
    }
    if (
      r.includes('fetch failed') ||
      r.includes('econnrefused') ||
      r.includes('enotfound') ||
      r.includes('network') ||
      r.includes('timeout') ||
      r.includes('socket')
    ) {
      return {
        section, raw, category: 'network',
        message: 'Network error reaching Jobber API',
        hint: 'Could not reach api.getjobber.com. Check Vercel function logs for connectivity issues.',
      }
    }
    return {
      section, raw, category: 'unknown',
      message: raw.slice(0, 120),
      hint: 'See raw error below for full details.',
    }
  }

  // Per-section debug counters surfaced in the response payload
  const debug = {
    jobs_fetched: 0,
    jobs_inserted: 0,
    jobs_skipped_no_client: 0,
    jobs_skipped_db_error: 0,
    jobs_first_node_sample: null as unknown,
    invoices_fetched: 0,
    invoices_inserted: 0,
    invoices_skipped_no_client: 0,
    invoices_skipped_db_error: 0,
    invoices_first_node_sample: null as unknown,
    skip_reasons: [] as string[],
  }

  const results = { clients: 0, jobs: 0, invoices: 0, errors: [] as SyncError[] }

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  // Jobber uses a leaky-bucket rate limiter. Wrap each page query with one retry
  // on THROTTLED so that a momentary burst doesn't fail an entire section.
  async function jobberQueryWithRetry<T>(
    token: string, query: string, variables?: Record<string, unknown>
  ): Promise<T> {
    try {
      return await jobberQuery<T>(token, query, variables)
    } catch (err) {
      if (String(err).toLowerCase().includes('throttled')) {
        console.warn('[sync/jobber] THROTTLED — waiting 3s then retrying once')
        await sleep(3000)
        return await jobberQuery<T>(token, query, variables)
      }
      throw err
    }
  }

  // Helper: detect auth failures in caught errors and return a reconnect response
  async function checkForAuthError(err: unknown, section: string): Promise<NextResponse | null> {
    const msg = String(err)
    if (msg.includes('JOBBER_UNAUTHORIZED')) {
      console.error(`[sync/jobber] Auth error in ${section}:`, msg)
      try {
        await db.from('app_settings').upsert(
          { key: 'jobber_reconnect_required', value: 'true', description: 'Jobber reconnect required' },
          { onConflict: 'key' }
        )
        await db.from('app_settings').upsert(
          { key: 'jobber_last_error', value: msg.slice(0, 500), description: 'Last Jobber sync error' },
          { onConflict: 'key' }
        )
      } catch { /* non-fatal */ }
      return NextResponse.json({
        error: 'Jobber token rejected — disconnect and reconnect in Settings → Integrations.',
        detail: msg,
        disconnect_required: true,
      }, { status: 401 })
    }
    return null
  }

  // ── Sync clients ─────────────────────────────────────────────────────────
  try {
    let cursor: string | null = null
    do {
      const data: any = await jobberQueryWithRetry(accessToken, CLIENTS_QUERY, { cursor })
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
    const authResp = await checkForAuthError(err, 'clients')
    if (authResp) return authResp
    const e = categorizeError(String(err), 'clients')
    console.error(`[sync/jobber] CLIENTS ${e.category.toUpperCase()}:`, e.raw)
    results.errors.push(e)
  }

  // ── Sync jobs ─────────────────────────────────────────────────────────────
  await sleep(1500)  // let the leaky bucket refill after clients sync
  try {
    let cursor: string | null = null
    do {
      const data: any = await jobberQueryWithRetry(accessToken, JOBS_QUERY, { cursor })
      const nodes: any[] = data.jobs?.nodes || []
      cursor = data.jobs?.pageInfo?.hasNextPage ? data.jobs.pageInfo.endCursor : null

      debug.jobs_fetched += nodes.length

      // Capture first node to expose field names/values in debug output
      if (debug.jobs_first_node_sample === null && nodes.length > 0) {
        const sample = nodes[0]
        debug.jobs_first_node_sample = {
          id: sample.id,
          title: sample.title,
          jobStatus: sample.jobStatus,
          total: sample.total,
          client_id_from_api: sample.client?.id ?? null,
          timesheetEntries_count: sample.timesheetEntries?.nodes?.length ?? sample.timeSheetEntries?.nodes?.length ?? 'field_missing',
        }
      }

      for (const j of nodes) {
        // Support both casing variants — schema says timesheetEntries (lowercase s)
        const tsEntries = j.timesheetEntries?.nodes ?? j.timeSheetEntries?.nodes ?? []
        // finalDuration is Seconds scalar
        const totalHours = tsEntries.reduce(
          (sum: number, entry: any) => sum + (Number(entry.finalDuration) || 0) / 3600,
          0
        )
        const laborCents = Math.round(totalHours * BURDENED_LABOR_RATE * 100)
        // Job.total is a Float scalar per schema
        const revenueCents = Math.round((Number(j.total) || 0) * 100)
        const margin = grossMargin(revenueCents, laborCents)

        const clientJobberId = j.client?.id ?? null

        if (!clientJobberId) {
          debug.jobs_skipped_no_client++
          debug.skip_reasons.push(`job ${j.id} (${j.title}): client.id missing in API response`)
          console.warn(`[sync/jobber] Job ${j.id} skipped — j.client.id is null/undefined`)
          continue
        }

        const { data: clientRow, error: clientLookupErr } = await db
          .from('clients')
          .select('id')
          .eq('jobber_id', clientJobberId)
          .maybeSingle()  // maybeSingle returns null without error when no row found

        if (clientLookupErr) {
          debug.jobs_skipped_no_client++
          debug.skip_reasons.push(`job ${j.id}: client DB lookup error — ${clientLookupErr.message}`)
          console.error(`[sync/jobber] Job ${j.id} — client lookup DB error:`, clientLookupErr.message)
          continue
        }

        if (!clientRow) {
          debug.jobs_skipped_no_client++
          debug.skip_reasons.push(`job ${j.id} (${j.title}): no client row found for jobber_id=${clientJobberId}`)
          console.warn(`[sync/jobber] Job ${j.id} skipped — clients table has no row with jobber_id=${clientJobberId}`)
          continue
        }

        const { error: upsertErr } = await db.from('jobs').upsert({
          jobber_id: j.id,
          title: j.title || 'Untitled Job',
          job_number: j.jobNumber || null,
          client_id: clientRow.id,
          status: mapJobberJobStatus(j.jobStatus || ''),
          contract_value_cents: revenueCents,
          burdened_labor_cents: laborCents,
          total_hours: totalHours,
          gross_margin: margin,
          start_date: j.startAt ? j.startAt.split('T')[0] : (j.createdAt ? j.createdAt.split('T')[0] : null),
          end_date: j.completedAt ? j.completedAt.split('T')[0] : null,
        }, { onConflict: 'jobber_id' })

        if (upsertErr) {
          debug.jobs_skipped_db_error++
          debug.skip_reasons.push(`job ${j.id}: DB upsert failed — ${upsertErr.message}`)
          console.error(`[sync/jobber] Job ${j.id} upsert error:`, upsertErr.message)
        } else {
          debug.jobs_inserted++
          results.jobs++
        }
      }
    } while (cursor)
  } catch (err) {
    const authResp = await checkForAuthError(err, 'jobs')
    if (authResp) return authResp
    const e = categorizeError(String(err), 'jobs')
    console.error(`[sync/jobber] JOBS ${e.category.toUpperCase()}:`, e.raw)
    results.errors.push(e)
  }

  // ── Sync invoices ─────────────────────────────────────────────────────────
  await sleep(1500)  // let the leaky bucket refill after jobs sync
  try {
    let cursor: string | null = null
    do {
      const data: any = await jobberQueryWithRetry(accessToken, INVOICES_QUERY, { cursor })
      console.log('[sync/jobber] invoices page:', JSON.stringify(data).slice(0, 500))
      const nodes = data.invoices?.nodes || []
      cursor = data.invoices?.pageInfo?.hasNextPage ? data.invoices.pageInfo.endCursor : null

      debug.invoices_fetched += nodes.length

      // Capture first node to expose field names/values in debug output
      if (debug.invoices_first_node_sample === null && nodes.length > 0) {
        const s = nodes[0]
        debug.invoices_first_node_sample = {
          id: s.id,
          invoiceNumber: s.invoiceNumber,
          invoiceStatus: s.invoiceStatus,
          invoiceNet: s.invoiceNet,
          amounts: s.amounts,
          jobs_nodes_count: s.jobs?.nodes?.length ?? 'field_missing',
          first_job_client_id: s.jobs?.nodes?.[0]?.client?.id ?? null,
        }
      }

      for (const inv of nodes) {
        // amounts.total / amounts.balance come from Invoice.amounts (InvoiceAmounts type)
        // invoiceNet is a fallback Float scalar also on Invoice
        const amountCents = Math.round(((inv.amounts?.total ?? inv.invoiceNet) || 0) * 100)
        const balanceCents = Math.round((inv.amounts?.balance || 0) * 100)
        // invoiceStatus replaces the removed `status` field
        const status = mapJobberInvoiceStatus(inv.invoiceStatus || '', inv.dueDate)

        // Client is not a direct field on Invoice — resolve via the first linked job
        // Invoice.jobs is a connection (JobConnection); nodes are Job objects with client
        const firstLinkedJob = inv.jobs?.nodes?.[0] ?? null
        const clientJobberId = firstLinkedJob?.client?.id ?? null

        if (!clientJobberId) {
          debug.invoices_skipped_no_client++
          debug.skip_reasons.push(`invoice ${inv.id} (${inv.invoiceNumber}): no linked job with client in API response`)
          console.warn(`[sync/jobber] Invoice ${inv.id} skipped — no linked job client`)
          continue
        }

        const { data: clientRow, error: clientLookupErr } = await db
          .from('clients')
          .select('id')
          .eq('jobber_id', clientJobberId)
          .maybeSingle()

        if (clientLookupErr) {
          debug.invoices_skipped_no_client++
          debug.skip_reasons.push(`invoice ${inv.id}: client DB lookup error — ${clientLookupErr.message}`)
          console.error(`[sync/jobber] Invoice ${inv.id} — client lookup error:`, clientLookupErr.message)
          continue
        }

        if (!clientRow) {
          debug.invoices_skipped_no_client++
          debug.skip_reasons.push(`invoice ${inv.id} (${inv.invoiceNumber}): no client row for jobber_id=${clientJobberId}`)
          console.warn(`[sync/jobber] Invoice ${inv.id} skipped — clients table has no row with jobber_id=${clientJobberId}`)
          continue
        }

        // Resolve FK: job (optional) — use maybeSingle so missing job doesn't throw
        let jobId: string | null = null
        if (firstLinkedJob?.id) {
          const { data: jobRow } = await db
            .from('jobs')
            .select('id')
            .eq('jobber_id', firstLinkedJob.id)
            .maybeSingle()
          jobId = jobRow?.id ?? null
        }

        // receivedDate replaces the removed paidDate field
        const { error: upsertErr } = await db.from('invoices').upsert({
          jobber_id: inv.id,
          invoice_number: inv.invoiceNumber || `JB-${inv.id.slice(-8).toUpperCase()}`,
          client_id: clientRow.id,
          job_id: jobId,
          amount_cents: amountCents,
          balance_cents: balanceCents,
          status,
          issue_date: inv.issuedDate || null,
          due_date: inv.dueDate || null,
          paid_date: status === 'paid' ? (inv.receivedDate || null) : null,
        }, { onConflict: 'jobber_id' })

        if (upsertErr) {
          debug.invoices_skipped_db_error++
          debug.skip_reasons.push(`invoice ${inv.id}: DB upsert failed — ${upsertErr.message}`)
          console.error(`[sync/jobber] Invoice ${inv.id} upsert error:`, upsertErr.message)
        } else {
          debug.invoices_inserted++
          results.invoices++
        }
      }
    } while (cursor)
  } catch (err) {
    const authResp = await checkForAuthError(err, 'invoices')
    if (authResp) return authResp
    const e = categorizeError(String(err), 'invoices')
    console.error(`[sync/jobber] INVOICES ${e.category.toUpperCase()}:`, e.raw)
    results.errors.push(e)
  }

  // ── Record sync timestamp + clear/update error state ─────────────────────
  const syncedAt = new Date().toISOString()
  const hasErrors = results.errors.length > 0
  try {
    await db.from('app_settings').upsert(
      { key: 'jobber_reconnect_required', value: 'false', description: 'Jobber reconnect required' },
      { onConflict: 'key' }
    )
    await db.from('app_settings').upsert(
      {
        key: 'jobber_last_sync_errors',
        value: hasErrors ? JSON.stringify(results.errors) : '[]',
        description: 'Last Jobber sync errors (JSON)',
      },
      { onConflict: 'key' }
    )
  } catch { /* non-fatal */ }

  await db.from('app_settings').upsert(
    { key: 'last_jobber_sync', value: syncedAt, description: 'Last successful Jobber sync' },
    { onConflict: 'key' }
  )

  return NextResponse.json({
    success: true,
    synced: {
      clients: results.clients,
      jobs: results.jobs,
      invoices: results.invoices,
      errors: results.errors.length,
    },
    // Human-readable summary for the settings page
    summary: [
      `${results.clients} client${results.clients !== 1 ? 's' : ''} → clients table`,
      `${results.jobs} job${results.jobs !== 1 ? 's' : ''} → jobs table (contract value, margin, timesheets)`,
      `${results.invoices} invoice${results.invoices !== 1 ? 's' : ''} → invoices table (amount, balance, status)`,
    ].join(' · '),
    debug,
    errors: results.errors,
    synced_at: syncedAt,
  })
}
