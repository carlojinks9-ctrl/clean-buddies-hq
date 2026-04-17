import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { refreshQboToken, getPnlReport, getArAgingReport } from '@/lib/qbo'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'

// ── QBO report helpers ────────────────────────────────────────────────────────

function findRowValue(rows: any[], groupName: string): number {
  if (!Array.isArray(rows)) return 0
  for (const row of rows) {
    if (row?.group === groupName) {
      const summary = row?.Summary?.ColData
      if (Array.isArray(summary) && summary.length >= 2) {
        return parseFloat(summary[1]?.value || '0') || 0
      }
    }
    // Recurse into nested rows
    if (row?.Rows?.Row) {
      const found = findRowValue(row.Rows.Row, groupName)
      if (found !== 0) return found
    }
  }
  return 0
}

function parsePnlReport(report: any) {
  const rows = report?.Rows?.Row || []
  const income = findRowValue(rows, 'Income') || findRowValue(rows, 'GrossProfit') || 0
  const expenses = findRowValue(rows, 'Expenses') || findRowValue(rows, 'TotalExpenses') || 0
  const netIncome = findRowValue(rows, 'NetIncome') || (income - expenses)
  const cogs = findRowValue(rows, 'COGS') || findRowValue(rows, 'CostOfGoodsSold') || 0
  const grossProfit = income - cogs
  const period = {
    start: report?.Header?.StartPeriod || '',
    end: report?.Header?.EndPeriod || '',
  }
  return { income, cogs, grossProfit, expenses, netIncome, period }
}

function parseArAgingReport(report: any) {
  // AgedReceivableDetail columns: Customer, Current, 1-30, 31-60, 61-90, 91+, Total
  const rows = report?.Rows?.Row || []
  const buckets = { current: 0, thirtyDays: 0, sixtyDays: 0, ninetyDays: 0, over90: 0, total: 0 }

  for (const row of rows) {
    if (row?.type === 'Data') {
      const cols: any[] = row?.ColData || []
      // Typical QBO AR aging detail: name | 0-30 | 31-60 | 61-90 | 91+ | total
      const vals = cols.map((c: any) => parseFloat(c?.value || '0') || 0)
      if (vals.length >= 5) {
        buckets.current += vals[1] || 0
        buckets.thirtyDays += vals[2] || 0
        buckets.sixtyDays += vals[3] || 0
        buckets.over90 += vals[4] || 0
      }
    }
    // Also check Summary rows
    if (row?.type === 'Section' && row?.Summary) {
      const cols: any[] = row.Summary?.ColData || []
      if (cols[0]?.value?.toLowerCase().includes('total')) {
        const vals = cols.map((c: any) => parseFloat(c?.value || '0') || 0)
        if (vals.length >= 5) {
          buckets.total += vals[vals.length - 1] || 0
        }
      }
    }
  }

  buckets.total = buckets.current + buckets.thirtyDays + buckets.sixtyDays + buckets.ninetyDays + buckets.over90
  return buckets
}

export async function GET() {
  const db = createServerClient()

  const { data: tokenRow } = await db
    .from('integration_tokens')
    .select('*')
    .eq('service', 'qbo')
    .single()

  if (!tokenRow) {
    return NextResponse.json({ error: 'QuickBooks not connected' }, { status: 400 })
  }

  let accessToken = tokenRow.access_token
  const realmId = tokenRow.metadata?.realm_id

  if (!realmId) {
    return NextResponse.json({ error: 'Missing QBO realm ID — reconnect QuickBooks' }, { status: 400 })
  }

  // Refresh token if within 60s of expiry
  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() - 60_000 < Date.now()) {
    try {
      const refreshed = await refreshQboToken(tokenRow.refresh_token!)
      accessToken = refreshed.access_token
      await db.from('integration_tokens').update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      }).eq('service', 'qbo')
    } catch (err) {
      return NextResponse.json({ error: 'Token refresh failed', detail: String(err) }, { status: 500 })
    }
  }

  const now = new Date()
  const errors: string[] = []

  // ── P&L — current month ──────────────────────────────────────────────────
  let pnl = null
  try {
    const start = format(startOfMonth(now), 'yyyy-MM-dd')
    const end = format(endOfMonth(now), 'yyyy-MM-dd')
    const raw = await getPnlReport(accessToken, realmId, start, end)
    pnl = parsePnlReport(raw)
  } catch (err) {
    console.error('[sync/qbo] P&L error:', err)
    errors.push(`P&L: ${err}`)
  }

  // ── P&L — last 6 months for chart ────────────────────────────────────────
  const monthlyTrend: Array<{ month: string; income: number; expenses: number; netIncome: number }> = []
  for (let i = 5; i >= 0; i--) {
    try {
      const monthDate = subMonths(now, i)
      const start = format(startOfMonth(monthDate), 'yyyy-MM-dd')
      const end = format(endOfMonth(monthDate), 'yyyy-MM-dd')
      const raw = await getPnlReport(accessToken, realmId, start, end)
      const parsed = parsePnlReport(raw)
      monthlyTrend.push({
        month: format(monthDate, 'MMM'),
        income: parsed.income,
        expenses: parsed.expenses,
        netIncome: parsed.netIncome,
      })
    } catch (err) {
      errors.push(`Trend month ${i}: ${err}`)
    }
  }

  // ── AR Aging ──────────────────────────────────────────────────────────────
  let arAging = null
  try {
    const raw = await getArAgingReport(accessToken, realmId)
    arAging = parseArAgingReport(raw)
  } catch (err) {
    console.error('[sync/qbo] AR aging error:', err)
    errors.push(`AR: ${err}`)
  }

  // ── Store snapshot in app_settings ───────────────────────────────────────
  const syncedAt = new Date().toISOString()
  await db.from('app_settings').upsert(
    { key: 'last_qbo_sync', value: syncedAt, description: 'Last QBO data sync timestamp' },
    { onConflict: 'key' }
  )
  if (pnl) {
    await db.from('app_settings').upsert(
      { key: 'qbo_pnl_snapshot', value: JSON.stringify({ ...pnl, synced_at: syncedAt }), description: 'Latest QBO P&L snapshot' },
      { onConflict: 'key' }
    )
  }
  if (arAging) {
    await db.from('app_settings').upsert(
      { key: 'qbo_ar_snapshot', value: JSON.stringify({ ...arAging, synced_at: syncedAt }), description: 'Latest QBO AR aging snapshot' },
      { onConflict: 'key' }
    )
  }

  return NextResponse.json({
    ok: true,
    synced_at: syncedAt,
    pnl,
    monthly_trend: monthlyTrend,
    ar_aging: arAging,
    errors,
  })
}
