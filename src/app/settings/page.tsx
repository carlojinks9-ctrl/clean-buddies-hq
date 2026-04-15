'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Settings, Zap, Calendar, Receipt, Send, Globe, Save, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'

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
    status: 'not_connected',
    authPath: '/api/jobber/authorize',
    docsUrl: 'https://developer.getjobber.com',
  },
  {
    id: 'google',
    name: 'Google (Calendar + Gmail)',
    description: 'Schedule sync, email notifications',
    icon: '📅',
    status: 'not_connected',
    authPath: '/api/google/authorize',
    docsUrl: 'https://developers.google.com',
  },
  {
    id: 'qbo',
    name: 'QuickBooks Online',
    description: 'P&L, AR aging, payroll reconciliation',
    icon: '📊',
    status: 'not_connected',
    authPath: '/api/qbo/authorize',
    docsUrl: 'https://developer.intuit.com',
  },
  {
    id: 'telegram',
    name: 'Telegram Bot',
    description: 'CB Assistant — crew monitoring, supply requests',
    icon: '📱',
    status: process.env.NEXT_PUBLIC_APP_URL ? 'connected' : 'not_connected',
    authPath: null,
    docsUrl: 'https://core.telegram.org/bots',
  },
]

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSetting[]>([])
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [integrationStatus, setIntegrationStatus] = useState<Record<string, boolean>>({})

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('app_settings').select('*')
      const items = (data || []) as AppSetting[]
      setSettings(items)
      const vals: Record<string, string> = {}
      items.forEach(s => { vals[s.key] = s.value })
      setEditing(vals)

      // Check which integrations have tokens
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
      await supabase.from('app_settings').update({ value }).eq('key', key)
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const EDITABLE_SETTINGS = [
    { key: 'burdened_labor_rate', label: 'Burdened Labor Rate ($/hr)', type: 'number', prefix: '$', suffix: '/hr' },
    { key: 'target_margin', label: 'Target Gross Margin', type: 'number', prefix: '', suffix: ' (0.65 = 65%)' },
    { key: 'floor_margin', label: 'Floor Gross Margin', type: 'number', prefix: '', suffix: ' (0.50 = 50%)' },
    { key: 'employer_cost_multiplier', label: 'Employer Cost Multiplier', type: 'number', prefix: '×', suffix: '' },
  ]

  return (
    <div className="space-y-6 max-w-3xl">
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
            return (
              <div key={integration.id} className="flex items-center gap-4 px-4 py-4">
                <div className="w-10 h-10 rounded-xl bg-bg-elevated border border-white/[0.06] flex items-center justify-center text-xl flex-shrink-0">
                  {integration.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-text-primary">{integration.name}</p>
                    <Badge variant={isConnected ? 'green' : 'gray'} dot>
                      {isConnected ? 'Connected' : 'Not connected'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-text-tertiary mt-0.5">{integration.description}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
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
                  {integration.authPath && !isConnected && (
                    <a href={integration.authPath}>
                      <Button variant="secondary" size="sm">Connect</Button>
                    </a>
                  )}
                  {isConnected && (
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
              { key: 'App URL', value: process.env.NEXT_PUBLIC_APP_URL || 'localhost:3000' },
              { key: 'Supabase', value: process.env.NEXT_PUBLIC_SUPABASE_URL ? '✓ Configured' : '✗ Missing' },
              { key: 'Jobber Client', value: process.env.JOBBER_CLIENT_ID ? '✓ Configured' : '✗ Missing (server-side only)' },
              { key: 'Google OAuth', value: process.env.GOOGLE_CLIENT_ID ? '✓ Configured' : '✗ Missing (server-side only)' },
            ].map(({ key, value }) => (
              <div key={key} className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
                <span className="text-text-tertiary">{key}</span>
                <span className={value.startsWith('✓') ? 'text-brand-green' : value.startsWith('✗') ? 'text-accent-red' : 'text-text-secondary'}>
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
