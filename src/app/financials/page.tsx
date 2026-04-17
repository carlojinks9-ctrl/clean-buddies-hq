'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { MonoValue } from '@/components/ui/MonoValue'
import { Button } from '@/components/ui/Button'
import { RevenueChart } from '@/components/charts/RevenueChart'
import {
  DollarSign, TrendingDown, AlertCircle, Upload, BarChart3,
  RefreshCw, TrendingUp, Minus, CheckCircle2,
} from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import type { Invoice, PayrollImport } from '@/types'
import { formatCents } from '@/lib/margin'

const AR_BUCKETS = [
  { label: 'Current (0–30d)',  min: 0,  max: 30,  variant: 'green' as const },
  { label: '31–60 days',       min: 31, max: 60,  variant: 'amber' as const },
  { label: '61–90 days',       min: 61, max: 90,  variant: 'amber' as const },
  { label: '90+ days',         min: 91, max: 9999, variant: 'red' as const },
]

function daysSinceIssue(issueDate: string | null): number {
  if (!issueDate) return 0
  return Math.floor((Date.now() - new Date(issueDate).getTime()) / (1000 * 60 * 60 * 24))
}

function dollarsToCents(dollars: number) {
  return Math.round(dollars * 100)
}

interface QboPnl {
  income: number
  cogs: number
  grossProfit: number
  expenses: number
  netIncome: number
  period: { start: string; end: string }
  synced_at: string
}

interface QboAr {
  current: number
  thirtyDays: number
  sixtyDays: number
  ninetyDays: number
  over90: number
  total: number
  synced_at: string
}

export default function FinancialsPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payrolls, setPayrolls] = useState<PayrollImport[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // QBO state
  const [qboPnl, setQboPnl] = useState<QboPnl | null>(null)
  const [qboAr, setQboAr] = useState<QboAr | null>(null)
  const [qboConnected, setQboConnected] = useState<boolean | null>(null)
  const [syncingQbo, setSyncingQbo] = useState(false)
  const [qboSyncResult, setQboSyncResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [invRes, payRes, settingsRes, tokenRes] = await Promise.all([
        supabase.from('invoices').select('*, client:clients(name, company_name)').order('issue_date', { ascending: false }),
        supabase.from('payroll_imports').select('*').order('period_start', { ascending: false }).limit(6),
        supabase.from('app_settings').select('key, value').in('key', ['qbo_pnl_snapshot', 'qbo_ar_snapshot']),
        supabase.from('integration_tokens').select('service').eq('service', 'qbo').maybeSingle(),
      ])
      setInvoices((invRes.data || []) as Invoice[])
      setPayrolls((payRes.data || []) as PayrollImport[])
      setQboConnected(!!tokenRes.data)

      const settings = settingsRes.data || []
      const pnlSetting = settings.find(s => s.key === 'qbo_pnl_snapshot')
      const arSetting = settings.find(s => s.key === 'qbo_ar_snapshot')
      if (pnlSetting?.value) {
        try { setQboPnl(JSON.parse(pnlSetting.value)) } catch { /* ignore */ }
      }
      if (arSetting?.value) {
        try { setQboAr(JSON.parse(arSetting.value)) } catch { /* ignore */ }
      }
      setLoading(false)
    }
    load()
  }, [])

  async function syncQbo() {
    setSyncingQbo(true)
    setQboSyncResult(null)
    try {
      const res = await fetch('/api/sync/qbo')
      const json = await res.json()
      if (!res.ok || json.error) {
        setQboSyncResult({ ok: false, message: json.error || 'QBO sync failed' })
      } else {
        setQboPnl(json.pnl ? { ...json.pnl, synced_at: json.synced_at } : null)
        setQboAr(json.ar_aging ? { ...json.ar_aging, synced_at: json.synced_at } : null)
        const errs = json.errors?.length ? ` (${json.errors.length} warning${json.errors.length !== 1 ? 's' : ''})` : ''
        setQboSyncResult({ ok: true, message: `QBO synced successfully${errs}` })
      }
    } catch (err) {
      setQboSyncResult({ ok: false, message: String(err) })
    }
    setSyncingQbo(false)
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadStatus(null)

    try {
      const Papa = (await import('papaparse')).default
      const text = await file.text()
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const rows = results.data as Record<string, string>[]
          let totalGross = 0, totalNet = 0, totalTaxes = 0
          let periodStart = '', periodEnd = ''

          rows.forEach(row => {
            const gross = parseFloat(row['Gross Pay'] || row['gross_pay'] || '0')
            const net = parseFloat(row['Net Pay'] || row['net_pay'] || '0')
            totalGross += gross
            totalNet += net
            totalTaxes += (gross - net)
            if (!periodStart) {
              periodStart = row['Period Start'] || row['period_start'] || ''
              periodEnd = row['Period End'] || row['period_end'] || ''
            }
          })

          await supabase.from('payroll_imports').insert({
            period_start: periodStart || new Date().toISOString().split('T')[0],
            period_end: periodEnd || new Date().toISOString().split('T')[0],
            total_gross_cents: Math.round(totalGross * 100),
            total_net_cents: Math.round(totalNet * 100),
            total_taxes_cents: Math.round(totalTaxes * 100),
            employee_count: rows.length,
            imported_by: 'carlo',
            raw_csv: text.slice(0, 5000),
          })

          const { data } = await supabase.from('payroll_imports').select('*').order('period_start', { ascending: false }).limit(6)
          setPayrolls((data || []) as PayrollImport[])
          setUploadStatus(`Imported ${rows.length} employees. Total gross: ${formatCents(Math.round(totalGross * 100))}`)
          setUploading(false)
        },
        error: (err: Error) => {
          setUploadStatus(`Parse error: ${err.message}`)
          setUploading(false)
        },
      })
    } catch (err) {
      setUploadStatus(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      setUploading(false)
    }
  }

  const outstandingInvoices = invoices.filter(i => ['sent', 'overdue'].includes(i.status))
  const totalAr = outstandingInvoices.reduce((s, i) => s + i.balance_cents, 0)

  const arBuckets = AR_BUCKETS.map(bucket => ({
    ...bucket,
    invoices: outstandingInvoices.filter(i => {
      const days = daysSinceIssue(i.issue_date)
      return days >= bucket.min && days <= bucket.max
    }),
  }))

  const totalPayroll = payrolls.reduce((s, p) => s + p.total_gross_cents, 0)

  return (
    <div className="space-y-5">

      {/* QBO P&L Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-text-tertiary" />
            <CardTitle>P&amp;L — QuickBooks Online</CardTitle>
            {qboPnl && (
              <span className="text-[10px] text-text-tertiary font-mono ml-1">
                {qboPnl.period.start} → {qboPnl.period.end}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {qboConnected && (
              <Button
                size="sm"
                variant="secondary"
                loading={syncingQbo}
                icon={<RefreshCw className="w-3 h-3" />}
                onClick={syncQbo}
              >
                {syncingQbo ? 'Syncing…' : 'Sync QBO'}
              </Button>
            )}
            {qboPnl && (
              <span className="text-[10px] text-text-tertiary font-mono">
                {formatDistanceToNow(new Date(qboPnl.synced_at))} ago
              </span>
            )}
          </div>
        </CardHeader>

        {qboSyncResult && (
          <div className={`mx-4 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
            qboSyncResult.ok ? 'bg-brand-green/5 border border-brand-green/20 text-brand-green' : 'bg-accent-red/5 border border-accent-red/20 text-accent-red'
          }`}>
            {qboSyncResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
            {qboSyncResult.message}
          </div>
        )}

        {qboPnl ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/[0.04]">
            <div className="bg-bg-surface p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp className="w-3.5 h-3.5 text-brand-green" />
                <p className="text-[10px] text-text-tertiary uppercase tracking-wider">Revenue</p>
              </div>
              <MonoValue cents={dollarsToCents(qboPnl.income)} size="lg" color="text-brand-green" />
            </div>
            <div className="bg-bg-surface p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingDown className="w-3.5 h-3.5 text-accent-amber" />
                <p className="text-[10px] text-text-tertiary uppercase tracking-wider">Expenses</p>
              </div>
              <MonoValue cents={dollarsToCents(qboPnl.expenses)} size="lg" color="text-accent-amber" />
            </div>
            {qboPnl.cogs > 0 && (
              <div className="bg-bg-surface p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Minus className="w-3.5 h-3.5 text-text-tertiary" />
                  <p className="text-[10px] text-text-tertiary uppercase tracking-wider">COGS</p>
                </div>
                <MonoValue cents={dollarsToCents(qboPnl.cogs)} size="lg" />
              </div>
            )}
            <div className="bg-bg-surface p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <DollarSign className={`w-3.5 h-3.5 ${qboPnl.netIncome >= 0 ? 'text-brand-green' : 'text-accent-red'}`} />
                <p className="text-[10px] text-text-tertiary uppercase tracking-wider">Net Income</p>
              </div>
              <MonoValue
                cents={dollarsToCents(Math.abs(qboPnl.netIncome))}
                size="lg"
                color={qboPnl.netIncome >= 0 ? 'text-brand-green' : 'text-accent-red'}
              />
              {qboPnl.netIncome < 0 && <p className="text-[10px] text-accent-red mt-0.5">loss</p>}
            </div>
          </div>
        ) : qboConnected === false ? (
          <CardContent>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-white/[0.08] bg-bg-elevated">
              <AlertCircle className="w-4 h-4 text-text-tertiary flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-text-secondary">QuickBooks Online not connected</p>
                <p className="text-[11px] text-text-tertiary">Connect to pull live P&amp;L, balance sheet, and AR data.</p>
              </div>
              <a href="/settings" className="text-[11px] text-brand-green hover:underline flex-shrink-0">Connect →</a>
            </div>
          </CardContent>
        ) : (
          <CardContent>
            <p className="text-sm text-text-tertiary text-center py-4">
              Click <strong className="text-text-secondary">Sync QBO</strong> to pull the latest P&amp;L data.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Top KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Outstanding AR</p>
          <MonoValue cents={totalAr} size="xl" color={totalAr > 0 ? 'text-accent-amber' : 'text-brand-green'} />
          <p className="text-[11px] text-text-tertiary mt-0.5">{outstandingInvoices.length} unpaid invoices</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Overdue</p>
          <MonoValue cents={invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.balance_cents, 0)} size="xl" color="text-accent-red" />
          <p className="text-[11px] text-text-tertiary mt-0.5">{invoices.filter(i => i.status === 'overdue').length} invoices past due</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Payroll (YTD imports)</p>
          <MonoValue cents={totalPayroll} size="xl" />
          <p className="text-[11px] text-text-tertiary mt-0.5">{payrolls.length} payroll periods</p>
        </div>
      </div>

      {/* Revenue Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-text-tertiary" />
            <CardTitle>Monthly Revenue Trend</CardTitle>
          </div>
          <span className="text-[11px] text-text-tertiary">Oct 2025 — Apr 2026</span>
        </CardHeader>
        <CardContent className="pt-2">
          <RevenueChart />
          <p className="text-[10px] text-text-tertiary mt-2 text-center">
            ― Actual &nbsp;&nbsp; - - Target &nbsp;&nbsp; {qboConnected ? 'Sync QBO above for live data' : 'Connect QuickBooks for live data'}
          </p>
        </CardContent>
      </Card>

      {/* AR Aging — QBO data if available, otherwise from Jobber invoices */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-text-tertiary" />
            <CardTitle>AR Aging Report</CardTitle>
            {qboAr && <Badge variant="green" dot>QBO Live</Badge>}
          </div>
          <MonoValue cents={qboAr ? dollarsToCents(qboAr.total) : totalAr} size="sm" color="text-accent-amber" />
        </CardHeader>

        {qboAr ? (
          <div className="grid grid-cols-4 gap-px bg-white/[0.04]">
            {[
              { label: 'Current (0–30d)', amount: qboAr.current, warn: false },
              { label: '31–60 days',       amount: qboAr.thirtyDays, warn: true },
              { label: '61–90 days',       amount: qboAr.sixtyDays,  warn: true },
              { label: '90+ days',         amount: qboAr.over90,     warn: true },
            ].map(b => (
              <div key={b.label} className="bg-bg-surface p-3">
                <p className="text-[10px] text-text-tertiary mb-1">{b.label}</p>
                <MonoValue
                  cents={dollarsToCents(b.amount)}
                  size="sm"
                  color={b.warn && b.amount > 0 ? 'text-accent-red' : 'text-text-primary'}
                />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-px bg-white/[0.04]">
              {arBuckets.map(bucket => (
                <div key={bucket.label} className="bg-bg-surface p-3">
                  <p className="text-[10px] text-text-tertiary mb-1">{bucket.label}</p>
                  <MonoValue
                    cents={bucket.invoices.reduce((s, i) => s + i.balance_cents, 0)}
                    size="sm"
                    color={bucket.invoices.length > 0 && bucket.min > 30 ? 'text-accent-red' : 'text-text-primary'}
                  />
                  <p className="text-[10px] text-text-tertiary mt-0.5">{bucket.invoices.length} inv.</p>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Client</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Balance</th>
                    <th>Issue Date</th>
                    <th>Due Date</th>
                    <th>Age</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="text-center py-4 text-text-tertiary text-xs">Loading...</td></tr>
                  ) : outstandingInvoices.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-4 text-text-tertiary text-xs">No outstanding invoices</td></tr>
                  ) : outstandingInvoices.map(inv => {
                    const days = daysSinceIssue(inv.issue_date)
                    return (
                      <tr key={inv.id}>
                        <td><span className="font-mono text-text-primary">{inv.invoice_number}</span></td>
                        <td>
                          <span className="text-sm">{(inv.client as any)?.company_name || (inv.client as any)?.name || '—'}</span>
                        </td>
                        <td className="text-right"><MonoValue cents={inv.amount_cents} size="sm" /></td>
                        <td className="text-right"><MonoValue cents={inv.balance_cents} size="sm" color="text-accent-amber" /></td>
                        <td><span className="text-[11px] text-text-tertiary font-mono">{inv.issue_date ? format(new Date(inv.issue_date), 'MMM d, yyyy') : '—'}</span></td>
                        <td><span className="text-[11px] text-text-tertiary font-mono">{inv.due_date ? format(new Date(inv.due_date), 'MMM d, yyyy') : '—'}</span></td>
                        <td>
                          <span className={`text-xs font-mono ${days > 60 ? 'text-accent-red' : days > 30 ? 'text-accent-amber' : 'text-text-secondary'}`}>
                            {days}d
                          </span>
                        </td>
                        <td>
                          <Badge variant={inv.status === 'overdue' ? 'red' : 'amber'} dot>
                            {inv.status}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* Gusto CSV Upload */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-text-tertiary" />
            <CardTitle>Gusto Payroll Import</CardTitle>
          </div>
          <span className="text-[11px] text-text-tertiary">CSV upload (no API access yet)</span>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-white/[0.08] rounded-xl p-6 text-center hover:border-brand-green/30 transition-colors">
            <Upload className="w-8 h-8 text-text-tertiary mx-auto mb-2 opacity-40" />
            <p className="text-sm text-text-secondary mb-1">Upload Gusto payroll CSV export</p>
            <p className="text-[11px] text-text-tertiary mb-4">
              From Gusto: Reports → Payroll History → Export CSV
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleCsvUpload}
              className="hidden"
            />
            <Button
              variant="secondary"
              size="sm"
              loading={uploading}
              icon={<Upload className="w-3 h-3" />}
              onClick={() => fileRef.current?.click()}
            >
              Choose CSV File
            </Button>
            {uploadStatus && (
              <p className={`text-xs mt-3 ${uploadStatus.startsWith('Import') ? 'text-brand-green' : 'text-accent-red'}`}>
                {uploadStatus}
              </p>
            )}
          </div>

          {payrolls.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-text-tertiary font-medium uppercase tracking-wider mb-2">Recent Imports</p>
              {payrolls.map(p => (
                <div key={p.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-bg-elevated border border-white/[0.05]">
                  <div>
                    <p className="text-sm text-text-primary font-mono">
                      {format(new Date(p.period_start), 'MMM d')} — {format(new Date(p.period_end), 'MMM d, yyyy')}
                    </p>
                    <p className="text-[11px] text-text-tertiary">{p.employee_count} employees</p>
                  </div>
                  <div className="text-right">
                    <MonoValue cents={p.total_gross_cents} size="sm" />
                    <p className="text-[11px] text-text-tertiary font-mono">gross</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
