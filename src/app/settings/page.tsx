'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import {
  Settings, Zap, Calendar, Receipt, Send, Globe,
  Save, CheckCircle2, AlertCircle, ExternalLink, RefreshCw,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface AppSetting {
  key: string
  value: string
  description: string | null
}

const INTEGRATIONS = [
  {
    id: 'jobber',
    name: 'Jobber',
    description: 'Jobs, clients, invoices, timesheets',
    icon: '🔧',
    authPath: '/api/jobber/authorize',
    syncPath: '/api/sync/jobber',
    docsUrl: 'https://developer.getjobber.com',
  },
  {
    id: 'google',
    name: 'Google (Calendar + Gmail)',
    description: 'Schedule sync, email notifications',
    icon: '📅',
    authPath: '/api/google/authorize',
    syncPath: null,
    docsUrl: 'https://developers.google.com',
  },
  {
    id: 'qbo',
    name: 'QuickBooks Online',
    description: 'P&L, AR aging, payroll reconciliation',
    icon: '📊',
    authPath: '/api/qbo/authorize',
    syncPath: null,
    docsUrl: 'https://developer.intuit.com',
  },
  {
    id: 'telegram',
    name: 'Telegram Bot',
    description: 'CB Assistant — crew monitoring, supply requests',
    icon: '📱',
    authPath: null,
    syncPath: null,
    docsUrl: 'https://core.telegram.org/bots',
  },
]

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSetting[]>([])
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [integrationStatus, setIntegrationStatus] = useState<Record<string, boolean>>({})
  const [lastJobberSync, setLastJobberSync] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    // Handle OAuth callback query params
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === 'jobber') {
      setBanner({ type: 'success', message: 'Jobber connected successfully.' })
      window.history.replaceState({}, '', '/settings')
    } else if (params.get('error') === 'jobber_auth_failed') {
      setBanner({ type: 'error', message: 'Jobber connection failed — check your credentials and try again.' })
      window.history.replaceState({}, '', '/settings')
    }

    async function load() {
      const { data: settingsData } = await supabase.from('app_settings').select('*')
      const items = (settingsData || []) as AppSetting[]
      setSettings(items)
      const vals: Record<string, string> = {}
      items.forEach(s => {
        vals[s.key] = s.value
        if (s.key === 'last_jobber_sync') setLastJobberSync(s.value)
      })
      setEditing(vals)

      const { data: tokens } = await supabase.from('integration_tokens').select('service')
      const status: Record<string, boolean> = {}
      ;(tokens || []).forEach((t: any) => { status[t.service] = true })
      setIntegrationStatus(status)
    }
    load()
  }, [])

  async function saveSettings() {
    setSaving(true)
    for (const [key, value] of Object.entries(editing)) {
      if (key === 'last_jobber_sync') continue
      await supabase.from('app_settings').update({ value }).eq('key', key)
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  async function syncJobber() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/sync/jobber', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setSyncResult({ ok: false, message: json.error || 'Sync failed' })
      } else {
        const { synced, synced_at } = json
        setLastJobberSync(synced_at)
        setSyncResult({
          ok: true,
          message: `Synced ${synced.clients} clients · ${synced.jobs} jobs · ${synced.invoices} invoices${synced.errors.length ? ` · ${synced.errors.length} error(s)` : ''}`,
        })
      }
    } catch (err) {
      setSyncResult({ ok: false, message: String(err) })
    }
    setSyncing(false)
  }

  const EDITABLE_SETTINGS = [
    { key: 'burdened_labor_rate', label: 'Burdened Labor Rate ($/hr)', type: 'number', prefix: '$', suffix: '/hr' },
    { key: 'target_margin',       label: 'Target Gross Margin',        type: 'number', prefix: '',  suffix: ' (0.65 = 65%)' },
    { key: 'floor_margin',        label: 'Floor Gross Margin',         type: 'number', prefix: '',  suffix: ' (0.50 = 50%)' },
    { key: 'employer_cost_multiplier', label: 'Employer Cost Multiplier', type: 'number', prefix: '×', suffix: '' },
  ]

  return (
    <div className="space-y-6 max-w-3xl">

      {/* OAuth result banner */}
      {banner && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
          banner.type === 'success'
            ? 'bg-brand-green/5 border-brand-green/25 text-brand-green'
            : 'bg-accent-red/5 border-accent-red/25 text-accent-red'
        }`}>
          {banner.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
          <span>{banner.message}</span>
          <button
            onClick={() => setBanner(null)}
            className="ml-auto text-current opacity-60 hover:opacity-100 transition-opacity text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Business Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-text-tertiary" />
            <CardTitle>Business Configuration</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {EDITABLE_SETTINGS.map(({ key, label, type, prefix, suffix }) => (
              <div key={key}>
                <label className="block text-xs text-text-secondary mb-1.5 font-medium">{label}</label>
                <div className="flex items-center gap-2">
                  {prefix && <span className="text-sm text-text-tertiary">{prefix}</span>}
                  <input
                    type={type}
                    step="0.01"
                    value={editing[key] || ''}
                    onChange={e => setEditing(prev => ({ ...prev, [key]: e.target.value }))}
                    className="w-36 px-3 py-2 text-sm font-mono"
                  />
                  {suffix && <span className="text-xs text-text-tertiary">{suffix}</span>}
                </div>
              </div>
            ))}

            <div className="pt-2">
              <Button
                onClick={saveSettings}
                loading={saving}
                icon={saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              >
                {saved ? 'Saved!' : 'Save Settings'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Integrations */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-text-tertiary" />
            <CardTitle>Integrations</CardTitle>
          </div>
        </CardHeader>
        <div className="divide-y divide-white/[0.04]">
          {INTEGRATIONS.map(integration => {
            const isConnected = integrationStatus[integration.id] || false
            const isJobber = integration.id === 'jobber'

            return (
              <div key={integration.id} className="flex items-start gap-4 px-4 py-4">
                <div className="w-10 h-10 rounded-xl bg-bg-elevated border border-white/[0.06] flex items-center justify-center text-xl flex-shrink-0">
                  {integration.icon}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-text-primary">{integration.name}</p>
                    <Badge variant={isConnected ? 'green' : 'gray'} dot>
                      {isConnected ? 'Connected' : 'Not connected'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-text-tertiary mt-0.5">{integration.description}</p>

                  {/* Jobber-specific: last sync + sync result */}
                  {isJobber && isConnected && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] text-text-tertiary font-mono">
                        Last sync:{' '}
                        {lastJobberSync
                          ? `${formatDistanceToNow(new Date(lastJobberSync))} ago`
                          : 'never'}
                      </p>
                      {syncResult && (
                        <p className={`text-[11px] font-mono ${syncResult.ok ? 'text-brand-green' : 'text-accent-red'}`}>
                          {syncResult.ok ? '✓ ' : '✗ '}{syncResult.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                  {integration.docsUrl && (
                    <a
                      href={integration.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg hover:bg-white/[0.05] text-text-tertiary hover:text-text-secondary transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}

                  {/* Sync Now — Jobber only, when connected */}
                  {isJobber && isConnected && integration.syncPath && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={syncing}
                      icon={<RefreshCw className="w-3 h-3" />}
                      onClick={syncJobber}
                    >
                      {syncing ? 'Syncing…' : 'Sync Now'}
                    </Button>
                  )}

                  {integration.authPath && !isConnected && (
                    <a href={integration.authPath}>
                      <Button variant="secondary" size="sm">Connect</Button>
                    </a>
                  )}
                  {isConnected && !isJobber && (
                    <Button variant="ghost" size="sm" className="text-accent-red hover:text-accent-red">
                      Disconnect
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Telegram Bot Config */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-text-tertiary" />
            <CardTitle>Telegram Bot Setup</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-lg bg-bg-elevated border border-white/[0.06] text-xs text-text-secondary space-y-1.5">
            <p className="font-medium text-text-primary">Setup Steps:</p>
            <ol className="list-decimal list-inside space-y-1 text-text-secondary">
              <li>Add <code className="bg-white/10 px-1 rounded font-mono">@CBAssistantBot</code> to your crew Telegram group</li>
              <li>Copy the Group Chat ID and paste below</li>
              <li>Do the same for the Management private group</li>
              <li>Set the webhook URL: <code className="bg-white/10 px-1 rounded font-mono text-[10px]">/api/telegram/webhook</code></li>
            </ol>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">Crew Chat ID</label>
              <input className="w-full px-3 py-2 text-sm font-mono" placeholder="-1001234567890" />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">Management Chat ID</label>
              <input className="w-full px-3 py-2 text-sm font-mono" placeholder="-1009876543210" />
            </div>
            <Button size="sm" icon={<Save className="w-3.5 h-3.5" />}>Save Chat IDs</Button>
          </div>
        </CardContent>
      </Card>

      {/* Environment info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-text-tertiary" />
            <CardTitle>Environment</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 font-mono text-xs">
            {[
              { key: 'App URL',      value: process.env.NEXT_PUBLIC_APP_URL || 'localhost:3000' },
              { key: 'Supabase',     value: process.env.NEXT_PUBLIC_SUPABASE_URL ? '✓ Configured' : '✗ Missing' },
              { key: 'Jobber',       value: '✓ Configured (server-side)' },
              { key: 'Google OAuth', value: '✓ Configured (server-side)' },
            ].map(({ key, value }) => (
              <div key={key} className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
                <span className="text-text-tertiary">{key}</span>
                <span className={
                  value.startsWith('✓') ? 'text-brand-green'
                  : value.startsWith('✗') ? 'text-accent-red'
                  : 'text-text-secondary'
                }>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
