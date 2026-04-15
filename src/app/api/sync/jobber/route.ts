import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { jobberQuery, refreshJobberToken, JOBS_QUERY, CLIENTS_QUERY, INVOICES_QUERY } from '@/lib/jobber'
import { BURDENED_LABOR_RATE } from '@/lib/constants'
import { grossMargin } from '@/lib/margin'

export async function POST() {
  const db = createServerClient()

  // Get stored Jobber token
  const { data: tokenRow } = await db
    .from('integration_tokens')
    .select('*')
    .eq('service', 'jobber')
    .single()

  if (!tokenRow) {
    return NextResponse.json({ error: 'Jobber not connected' }, { status: 400 })
  }

  let accessToken = tokenRow.access_token

  // Refresh if expired
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
    try {
      const refreshed = await refreshJobberToken(tokenRow.refresh_token!)
      accessToken = refreshed.access_token
      await db.from('integration_tokens').update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      }).eq('service', 'jobber')
    } catch (err) {
      return NextResponse.json({ error: 'Token refresh failed', detail: String(err) }, { status: 500 })
    }
  }

  const results = { clients: 0, jobs: 0, invoices: 0, errors: [] as string[] }

  // Sync clients
  try {
    let clientCursor: string | null = null
    do {
      const clientData: any = await jobberQuery<any>(accessToken, CLIENTS_QUERY, { cursor: clientCursor })
      const clients = clientData.clients?.nodes || []
      clientCursor = clientData.clients?.pageInfo?.hasNextPage ? clientData.clients?.pageInfo?.endCursor : null

      for (const c of clients) {
        await db.from('clients').upsert({
          jobber_id: c.id,
          name: c.name,
          company_name: c.companyName || null,
          email: c.email || null,
          phone: c.phone || null,
          is_gc: c.isCompany || false,
        }, { onConflict: 'jobber_id' })
        results.clients++
      }
    } while (clientCursor)
  } catch (err) {
    results.errors.push(`Clients sync: ${err}`)
  }

  // Sync jobs
  try {
    let jobCursor: string | null = null
    do {
      const jobData: any = await jobberQuery<any>(accessToken, JOBS_QUERY, { cursor: jobCursor })
      const jobs = jobData.jobs?.nodes || []
      jobCursor = jobData.jobs?.pageInfo?.hasNextPage ? jobData.jobs?.pageInfo?.endCursor : null

      for (const j of jobs) {
        // Calculate burdened labor from timesheets
        const totalHours = (j.timesheetEntries?.nodes || []).reduce(
          (sum: number, entry: any) => sum + (entry.finalDuration || 0) / 3600, 0
        )
        const laborCents = Math.round(totalHours * BURDENED_LABOR_RATE * 100)
        const revenueCents = Math.round((j.total?.value || 0) * 100)
        const margin = grossMargin(revenueCents, laborCents)

        // Get client by jobber_id
        const { data: client } = await db.from('clients').select('id').eq('jobber_id', j.client?.id).single()

        if (client) {
          await db.from('jobs').upsert({
            jobber_id: j.id,
            title: j.title,
            job_number: j.jobNumber || null,
            client_id: client.id,
            status: (j.jobStatus || 'active').toLowerCase(),
            contract_value_cents: revenueCents,
            burdened_labor_cents: laborCents,
            total_hours: totalHours,
            gross_margin: margin,
          }, { onConflict: 'jobber_id' })
          results.jobs++
        }
      }
    } while (jobCursor)
  } catch (err) {
    results.errors.push(`Jobs sync: ${err}`)
  }

  return NextResponse.json({ success: true, synced: results })
}
