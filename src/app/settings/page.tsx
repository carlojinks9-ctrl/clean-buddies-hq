'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import {
  Settings, Zap, Send, Globe,
  Save, CheckCircle2, AlertCircle, ExternalLink, RefreshCw, Copy, Radio, LogOut, Phone, Bell, BellOff,
  Database, ShieldAlert,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { requestPushPermission } from '@/components/layout/PwaInit'

interface HealthStatus {
  integrations: {
    jobber: {
      connected: boolean
      token_expired: boolean | null
      expires_at: string | null
      connected_at: string | null
      last_sync: string | null
      reconnect_required: boolean
      last_error: string | null
      env_ok: boolean
    }
    quo: { api_key_set: boolean; last_sync: string | null }
    google: { connected: boolean; last_sync: string | null; env_ok: boolean }
    telegram: { token_set: boolean; mgmt_chat_configured: boolean; last_digest: string | null }
  }
  records: {
    clients: number; jobs: number; invoices: number; leads: number
    quo_calls: number; quo_messages: number; employees: number; tasks: number; supply_requests: number
  }
  env: Record<string, boolean>
}

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
    syncPath: '/api/sync/google',
    docsUrl: 'https://developers.google.com',
  },
  {
    id: 'qbo',
    name: 'QuickBooks Online',
    description: 'P&L, AR aging, payroll reconciliation',
    icon: '📊',
    authPath: '/api/qbo/authorize',
    syncPath: '/api/sync/qbo',
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
  const [lastQboSync, setLastQboSync] = useState<string | null>(null)
  const [lastGoogleSync, setLastGoogleSync] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncingIntegration, setSyncingIntegration] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [syncResults, setSyncResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null)
  const [loadingHealth, setLoadingHealth] = useState(true)

  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  // Telegram
  const [tgCrewId, setTgCrewId] = useState('')
  const [tgMgmtId, setTgMgmtId] = useState('')
  const [tgSaving, setTgSaving] = useState(false)
  const [tgSaved, setTgSaved] = useState(false)
  const [detectedChats, setDetectedChats] = useState<Array<{ chat_id: string; chat_title: string; chat_type: string; ts: string }>>([])
  const [webhookStatus, setWebhookStatus] = useState<{ url?: string; has_custom_certificate?: boolean; pending_update_count?: number } | null>(null)
  const [registeringWebhook, setRegisteringWebhook] = useState(false)
  const [webhookResult, setWebhookResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [sendingDigest, setSendingDigest] = useState(false)

  // Quo
  const [lastQuoSync, setLastQuoSync] = useState<string | null>(null)
  const [syncingQuo, setSyncingQuo] = useState(false)
  const [quoSyncResult, setQuoSyncResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [registeringQuoWebhook, setRegisteringQuoWebhook] = useState(false)
  const [quoWebhookResult, setQuoWebhookResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [quoWebhookStatus, setQuoWebhookStatus] = useState<{ url?: string } | null>(null)

  // Notifications / Push
  const [pushPermission, setPushPermission] = useState<NotificationPermission | null>(null)
  const [requestingPush, setRequestingPush] = useState(false)
  const [pushResult, setPushResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [testingNotif, setTestingNotif] = useState(false)
  const [carloTgUserId, setCarloTgUserId] = useState('')
  const [jordenTgUserId, setJordenTgUserId] = useState('')
  const [notifPrefs, setNotifPrefs] = useState({
    tasks: true, financial: true, jobs: true, leads: true, crew: true,
  })
  const [savingNotifPrefs, setSavingNotifPrefs] = useState(false)

  useEffect(() => {
    // Handle OAuth callback query params
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === 'jobber') {
      setBanner({ type: 'success', message: 'Jobber connected successfully.' })
      window.history.replaceState({}, '', '/settings')
    } else if (params.get('connected') === 'google') {
      setBanner({ type: 'success', message: 'Google connected successfully.' })
      window.history.replaceState({}, '', '/settings')
    } else if (params.get('connected') === 'qbo') {
      setBanner({ type: 'success', message: 'QuickBooks Online connected successfully.' })
      window.history.replaceState({}, '', '/settings')
    } else if (params.get('error') === 'jobber_auth_failed') {
      setBanner({ type: 'error', message: 'Jobber connection failed — check your credentials and try again.' })
      window.history.replaceState({}, '', '/settings')
    } else if (params.get('error') === 'google_auth_failed') {
      setBanner({ type: 'error', message: 'Google connection failed. Try again.' })
      window.history.replaceState({}, '', '/settings')
    } else if (params.get('error') === 'qbo_auth_failed') {
      setBanner({ type: 'error', message: 'QuickBooks connection failed. Try again.' })
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
        if (s.key === 'last_qbo_sync') setLastQboSync(s.value)
        if (s.key === 'last_google_sync') setLastGoogleSync(s.value)
        if (s.key === 'last_quo_sync') setLastQuoSync(s.value)
      })
      setEditing(vals)

      const { data: tokens } = await supabase.from('integration_tokens').select('service')
      const status: Record<string, boolean> = {}
      ;(tokens || []).forEach((t: any) => { status[t.service] = true })
      setIntegrationStatus(status)

      // Telegram chat IDs from app_settings
      const crewSetting = items.find(s => s.key === 'telegram_crew_chat_id')
      const mgmtSetting = items.find(s => s.key === 'telegram_management_chat_id')
      if (crewSetting) setTgCrewId(crewSetting.value)
      if (mgmtSetting) setTgMgmtId(mgmtSetting.value)

      // Detected chats from activity_feed
      const { data: chatEvents } = await supabase
        .from('activity_feed')
        .select('metadata, created_at')
        .eq('event_type', 'telegram_chat_detected')
        .order('created_at', { ascending: false })
        .limit(20)

      if (chatEvents) {
        // Deduplicate by chat_id, keep most recent
        const seen = new Set<string>()
        const unique: typeof detectedChats = []
        for (const ev of chatEvents) {
          const meta = ev.metadata as any
          if (meta?.chat_id && !seen.has(meta.chat_id)) {
            seen.add(meta.chat_id)
            unique.push({
              chat_id: meta.chat_id,
              chat_title: meta.chat_title || 'Unknown',
              chat_type: meta.chat_type || '',
              ts: ev.created_at,
            })
          }
        }
        setDetectedChats(unique)
      }
    }

    // Fetch current webhook status
    async function fetchWebhookStatus() {
      try {
        const res = await fetch('/api/telegram/setup')
        if (res.ok) {
          const data = await res.json()
          if (data.webhook_info) setWebhookStatus(data.webhook_info)
        }
      } catch { /* no-op */ }
    }

    async function fetchQuoWebhookStatus() {
      try {
        const res = await fetch('/api/quo/setup')
        if (res.ok) {
          const data = await res.json()
          if (data.webhooks?.[0]) setQuoWebhookStatus({ url: data.webhooks[0].url })
        }
      } catch { /* no-op */ }
    }

    load()
    fetchWebhookStatus()
    fetchQuoWebhookStatus()

    // Check current push permission state
    if ('Notification' in window) {
      setPushPermission(Notification.permission)
    }

    // Load integration health status
    fetch('/api/health')
      .then(r => r.json())
      .then((data: HealthStatus) => setHealthStatus(data))
      .catch(() => {})
      .finally(() => setLoadingHealth(false))
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
        const msg = json.disconnect_required
          ? json.error || 'Token refresh failed — disconnect and reconnect Jobber in Settings.'
          : (json.error || 'Sync failed')
        setSyncResult({ ok: false, message: msg })
        if (json.disconnect_required) {
          setBanner({ type: 'error', message: '⚠️ Jobber reconnection required — use the Disconnect button then Connect again.' })
        }
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
    // Refresh health status after sync attempt
    fetch('/api/health').then(r => r.json()).then(setHealthStatus).catch(() => {})
  }

  async function syncIntegration(id: string, path: string) {
    setSyncingIntegration(id)
    setSyncResults(prev => ({ ...prev, [id]: { ok: false, message: '' } }))
    try {
      const res = await fetch(path)
      const json = await res.json()
      if (json.error && !json.ok) {
        setSyncResults(prev => ({ ...prev, [id]: { ok: false, message: json.error } }))
      } else {
        const now = new Date().toISOString()
        if (id === 'qbo') setLastQboSync(now)
        if (id === 'google') setLastGoogleSync(now)
        const message = id === 'qbo'
          ? `Synced P&L${json.errors?.length ? ` · ${json.errors.length} warning(s)` : ''}`
          : id === 'google'
          ? `Fetched ${json.events?.length ?? 0} calendar events`
          : 'Synced'
        setSyncResults(prev => ({ ...prev, [id]: { ok: true, message } }))
      }
    } catch (err) {
      setSyncResults(prev => ({ ...prev, [id]: { ok: false, message: String(err) } }))
    }
    setSyncingIntegration(null)
  }

  async function saveTelegramIds() {
    setTgSaving(true)
    await Promise.all([
      supabase.from('app_settings').upsert(
        { key: 'telegram_crew_chat_id', value: tgCrewId, description: 'Telegram crew group chat ID' },
        { onConflict: 'key' }
      ),
      supabase.from('app_settings').upsert(
        { key: 'telegram_management_chat_id', value: tgMgmtId, description: 'Telegram management chat ID' },
        { onConflict: 'key' }
      ),
    ])
    setTgSaving(false)
    setTgSaved(true)
    setTimeout(() => setTgSaved(false), 3000)
  }

  async function registerWebhook() {
    setRegisteringWebhook(true)
    setWebhookResult(null)
    try {
      const res = await fetch('/api/telegram/setup', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setWebhookStatus(data.webhook_info)
        setWebhookResult({ ok: true, message: `Webhook registered: ${data.webhook_url}` })
      } else {
        setWebhookResult({ ok: false, message: data.error || 'Registration failed' })
      }
    } catch (err) {
      setWebhookResult({ ok: false, message: String(err) })
    }
    setRegisteringWebhook(false)
  }

  async function disconnectIntegration(service: string) {
    if (!confirm(`Disconnect ${service}? You'll need to reconnect to sync data.`)) return
    setDisconnecting(service)
    try {
      const res = await fetch('/api/integrations/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service }),
      })
      const data = await res.json()
      if (data.ok) {
        setIntegrationStatus(prev => ({ ...prev, [service]: false }))
        setBanner({ type: 'success', message: `${service} disconnected. Reconnect when ready.` })
      } else {
        setBanner({ type: 'error', message: data.error || 'Disconnect failed' })
      }
    } catch (err) {
      setBanner({ type: 'error', message: String(err) })
    }
    setDisconnecting(null)
  }

  async function syncQuo() {
    setSyncingQuo(true)
    setQuoSyncResult(null)
    try {
      const res = await fetch('/api/sync/quo', { method: 'POST' })
      const json = await res.json()
      if (json.success) {
        const { synced, synced_at } = json
        setLastQuoSync(synced_at)
        setQuoSyncResult({ ok: true, message: `Synced ${synced.calls} calls · ${synced.messages} messages · ${synced.flagged} flagged` })
      } else {
        setQuoSyncResult({ ok: false, message: json.error || 'Sync failed' })
      }
    } catch (err) {
      setQuoSyncResult({ ok: false, message: String(err) })
    }
    setSyncingQuo(false)
  }

  async function registerQuoWebhook() {
    setRegisteringQuoWebhook(true)
    setQuoWebhookResult(null)
    try {
      const res = await fetch('/api/quo/setup', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setQuoWebhookStatus({ url: data.webhook_url })
        setQuoWebhookResult({ ok: true, message: `Webhook registered: ${data.webhook_url}` })
      } else {
        setQuoWebhookResult({ ok: false, message: data.error || 'Registration failed' })
      }
    } catch (err) {
      setQuoWebhookResult({ ok: false, message: String(err) })
    }
    setRegisteringQuoWebhook(false)
  }

  async function sendDigestNow() {
    setSendingDigest(true)
    try {
      const res = await fetch('/api/telegram/digest', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setBanner({ type: 'success', message: `Daily digest sent to management chat.` })
      } else {
        setBanner({ type: 'error', message: data.error || 'Digest failed' })
      }
    } catch (err) {
      setBanner({ type: 'error', message: String(err) })
    }
    setSendingDigest(false)
  }

  async function enablePushNotifications() {
    setRequestingPush(true)
    setPushResult(null)
    const result = await requestPushPermission()
    setPushResult(result)
    if ('Notification' in window) setPushPermission(Notification.permission)
    setRequestingPush(false)
  }

  async function sendTestNotification() {
    setTestingNotif(true)
    try {
      const res = await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '🧹 CB HQ Test',
          message: 'Push notifications are working correctly!',
          priority: 'medium',
          link: '/',
        }),
      })
      const data = await res.json()
      setBanner(data.ok
        ? { type: 'success', message: `Test notification sent to ${data.sent} device${data.sent !== 1 ? 's' : ''}.` }
        : { type: 'error', message: data.error || 'Test failed' }
      )
    } catch (err) {
      setBanner({ type: 'error', message: String(err) })
    }
    setTestingNotif(false)
  }

  async function saveNotifPrefs() {
    setSavingNotifPrefs(true)
    await Promise.all([
      supabase.from('app_settings').upsert({ key: 'notif_tasks', value: String(notifPrefs.tasks), description: 'Task notifications' }, { onConflict: 'key' }),
      supabase.from('app_settings').upsert({ key: 'notif_financial', value: String(notifPrefs.financial), description: 'Financial notifications' }, { onConflict: 'key' }),
      supabase.from('app_settings').upsert({ key: 'notif_jobs', value: String(notifPrefs.jobs), description: 'Job notifications' }, { onConflict: 'key' }),
      supabase.from('app_settings').upsert({ key: 'notif_leads', value: String(notifPrefs.leads), description: 'Lead notifications' }, { onConflict: 'key' }),
      supabase.from('app_settings').upsert({ key: 'notif_crew', value: String(notifPrefs.crew), description: 'Crew/operations notifications' }, { onConflict: 'key' }),
      ...(carloTgUserId ? [supabase.from('app_settings').upsert({ key: 'telegram_carlo_user_id', value: carloTgUserId, description: "Carlo's Telegram user ID for DMs" }, { onConflict: 'key' })] : []),
      ...(jordenTgUserId ? [supabase.from('app_settings').upsert({ key: 'telegram_jorden_user_id', value: jordenTgUserId, description: "Jorden's Telegram user ID for DMs" }, { onConflict: 'key' })] : []),
    ])
    setSavingNotifPrefs(false)
    setBanner({ type: 'success', message: 'Notification preferences saved.' })
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
          {/* Jobber reconnect-required banner — persists across page loads */}
        {healthStatus && healthStatus.integrations.jobber.reconnect_required && (
          <div className="mx-4 my-2 flex items-start gap-3 px-4 py-3 rounded-xl bg-accent-red/5 border border-accent-red/25">
            <ShieldAlert className="w-4 h-4 text-accent-red flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-accent-red">Jobber reconnection required</p>
              <p className="text-xs text-accent-red/70 mt-0.5">
                {healthStatus.integrations.jobber.last_error
                  ? healthStatus.integrations.jobber.last_error.replace('JOBBER_UNAUTHORIZED: ', '')
                  : 'Token expired or revoked. Use Disconnect → Connect to get fresh tokens.'}
              </p>
            </div>
            <a href="/api/jobber/authorize">
              <Button size="sm" variant="secondary" className="border-accent-red/30 text-accent-red hover:text-accent-red">
                Reconnect →
              </Button>
            </a>
          </div>
        )}

        {/* Jobber expired-but-not-yet-flagged warning */}
        {healthStatus && !healthStatus.integrations.jobber.reconnect_required
          && healthStatus.integrations.jobber.token_expired === true && (
          <div className="mx-4 my-2 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-accent-amber/5 border border-accent-amber/25">
            <AlertCircle className="w-4 h-4 text-accent-amber flex-shrink-0" />
            <p className="text-xs text-accent-amber flex-1">
              Jobber token may be expired — try <strong>Sync Now</strong> to refresh it automatically, or reconnect if sync fails.
            </p>
            <a href="/api/jobber/authorize">
              <Button size="sm" variant="secondary">Reconnect</Button>
            </a>
          </div>
        )}

        {INTEGRATIONS.map(integration => {
            const isConnected = integrationStatus[integration.id] || false
            const isJobber = integration.id === 'jobber'
            const isGenericSync = !isJobber && isConnected && integration.syncPath
            const isSyncingThis = syncing || syncingIntegration === integration.id
            const lastSync = isJobber ? lastJobberSync
              : integration.id === 'qbo' ? lastQboSync
              : integration.id === 'google' ? lastGoogleSync
              : null
            const result = isJobber ? syncResult : syncResults[integration.id]

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

                  {isConnected && integration.syncPath && (
                    <div className="mt-2 space-y-0.5">
                      <p className="text-[11px] text-text-tertiary font-mono">
                        Last sync:{' '}
                        {lastSync ? `${formatDistanceToNow(new Date(lastSync))} ago` : 'never'}
                      </p>
                      {result?.message && (
                        <p className={`text-[11px] font-mono ${result.ok ? 'text-brand-green' : 'text-accent-red'}`}>
                          {result.ok ? '✓ ' : '✗ '}{result.message}
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

                  {isJobber && isConnected && integration.syncPath && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={isSyncingThis}
                      icon={<RefreshCw className="w-3 h-3" />}
                      onClick={syncJobber}
                    >
                      {isSyncingThis ? 'Syncing…' : 'Sync Now'}
                    </Button>
                  )}

                  {isGenericSync && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={isSyncingThis}
                      icon={<RefreshCw className="w-3 h-3" />}
                      onClick={() => syncIntegration(integration.id, integration.syncPath!)}
                    >
                      {isSyncingThis ? 'Syncing…' : 'Sync Now'}
                    </Button>
                  )}

                  {isConnected && integration.authPath && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={disconnecting === integration.id}
                      icon={<LogOut className="w-3 h-3" />}
                      onClick={() => disconnectIntegration(integration.id)}
                      className="text-accent-red/60 hover:text-accent-red"
                    >
                      {disconnecting === integration.id ? 'Disconnecting…' : 'Disconnect'}
                    </Button>
                  )}

                  {integration.authPath && !isConnected && (
                    <a href={integration.authPath}>
                      <Button variant="secondary" size="sm">Connect</Button>
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Quo (OpenPhone) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-text-tertiary" />
            <CardTitle>Quo / OpenPhone</CardTitle>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-green/10 text-brand-green font-medium">
              {process.env.NEXT_PUBLIC_APP_URL ? 'API key configured' : 'API key configured (server-side)'}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Sync */}
          <div>
            <p className="text-xs font-medium text-text-secondary mb-2">Data Sync</p>
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-[11px] font-mono text-text-tertiary">
                Last sync: {lastQuoSync ? `${formatDistanceToNow(new Date(lastQuoSync))} ago` : 'never'}
              </p>
              <Button
                size="sm"
                variant="secondary"
                loading={syncingQuo}
                icon={<RefreshCw className="w-3.5 h-3.5" />}
                onClick={syncQuo}
              >
                {syncingQuo ? 'Syncing…' : 'Sync Now'}
              </Button>
              <a href="/communications" className="text-[11px] text-accent-blue hover:underline">
                View Communications →
              </a>
            </div>
            {quoSyncResult && (
              <p className={`text-[11px] mt-1.5 font-mono ${quoSyncResult.ok ? 'text-brand-green' : 'text-accent-red'}`}>
                {quoSyncResult.ok ? '✓ ' : '✗ '}{quoSyncResult.message}
              </p>
            )}
          </div>

          {/* Webhook */}
          <div>
            <p className="text-xs font-medium text-text-secondary mb-2">Webhook (real-time events)</p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-0 p-2.5 rounded-lg bg-bg-elevated border border-white/[0.06] font-mono text-[11px]">
                {quoWebhookStatus?.url
                  ? <span className="text-brand-green">{quoWebhookStatus.url}</span>
                  : <span className="text-text-tertiary">Not registered</span>
                }
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={registeringQuoWebhook}
                icon={<Radio className="w-3.5 h-3.5" />}
                onClick={registerQuoWebhook}
              >
                {registeringQuoWebhook ? 'Registering…' : 'Register Webhook'}
              </Button>
            </div>
            {quoWebhookResult && (
              <p className={`text-[11px] mt-1.5 font-mono ${quoWebhookResult.ok ? 'text-brand-green' : 'text-accent-red'}`}>
                {quoWebhookResult.ok ? '✓ ' : '✗ '}{quoWebhookResult.message}
              </p>
            )}
            <p className="text-[10px] text-text-tertiary mt-2">
              Events: call.completed · call.summary.completed · message.received · message.sent
            </p>
          </div>

          <div className="p-3 rounded-lg bg-bg-elevated border border-white/[0.06] text-xs text-text-secondary space-y-1">
            <p className="font-medium text-text-primary">Setup</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Add <code className="font-mono text-accent-blue">QUO_API_KEY</code> and <code className="font-mono text-accent-blue">ANTHROPIC_API_KEY</code> to Vercel env vars</li>
              <li>Click <b>Register Webhook</b> to set up real-time events</li>
              <li>Click <b>Sync Now</b> to pull existing call history</li>
              <li>AI flagging activates automatically when <code className="font-mono">ANTHROPIC_API_KEY</code> is set</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Telegram Bot Config */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-text-tertiary" />
            <CardTitle>Telegram Bot</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Webhook status + register */}
          <div>
            <p className="text-xs font-medium text-text-secondary mb-2">Webhook</p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-0 p-2.5 rounded-lg bg-bg-elevated border border-white/[0.06] font-mono text-[11px]">
                {webhookStatus?.url
                  ? <span className="text-brand-green">{webhookStatus.url}</span>
                  : <span className="text-text-tertiary">Not registered</span>
                }
                {webhookStatus?.pending_update_count != null && webhookStatus.pending_update_count > 0 && (
                  <span className="ml-2 text-accent-amber">({webhookStatus.pending_update_count} pending)</span>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={registeringWebhook}
                icon={<Radio className="w-3.5 h-3.5" />}
                onClick={registerWebhook}
              >
                {registeringWebhook ? 'Registering…' : 'Register Webhook'}
              </Button>
            </div>
            {webhookResult && (
              <p className={`text-[11px] mt-1.5 font-mono ${webhookResult.ok ? 'text-brand-green' : 'text-accent-red'}`}>
                {webhookResult.ok ? '✓ ' : '✗ '}{webhookResult.message}
              </p>
            )}
          </div>

          {/* Chat IDs */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-text-secondary">Chat IDs</p>
            <div>
              <label className="block text-[11px] text-text-tertiary mb-1.5 uppercase tracking-wider font-medium">Crew Chat ID</label>
              <input
                value={tgCrewId}
                onChange={e => setTgCrewId(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono"
                placeholder="-1001234567890"
              />
            </div>
            <div>
              <label className="block text-[11px] text-text-tertiary mb-1.5 uppercase tracking-wider font-medium">Management Chat ID</label>
              <input
                value={tgMgmtId}
                onChange={e => setTgMgmtId(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono"
                placeholder="-1009876543210"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                loading={tgSaving}
                icon={tgSaved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                onClick={saveTelegramIds}
              >
                {tgSaved ? 'Saved!' : 'Save Chat IDs'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={sendingDigest}
                onClick={sendDigestNow}
              >
                Send Digest Now
              </Button>
            </div>
          </div>

          {/* Detected chats from activity_feed */}
          {detectedChats.length > 0 && (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-2">Detected Groups</p>
              <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                      <th className="text-left px-3 py-2 text-text-tertiary font-medium">Group Name</th>
                      <th className="text-left px-3 py-2 text-text-tertiary font-medium">Chat ID</th>
                      <th className="text-left px-3 py-2 text-text-tertiary font-medium">Type</th>
                      <th className="px-3 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {detectedChats.map(chat => (
                      <tr key={chat.chat_id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                        <td className="px-3 py-2 text-text-primary">{chat.chat_title}</td>
                        <td className="px-3 py-2 font-mono text-text-secondary">{chat.chat_id}</td>
                        <td className="px-3 py-2 text-text-tertiary capitalize">{chat.chat_type}</td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => navigator.clipboard.writeText(chat.chat_id)}
                            className="p-1 rounded hover:bg-white/[0.08] text-text-tertiary hover:text-text-primary transition-colors"
                            title="Copy chat ID"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-text-tertiary mt-1.5">
                The bot logs every group it receives a message in. Click <Copy className="w-2.5 h-2.5 inline" /> to copy, then paste into the fields above.
              </p>
            </div>
          )}

          {/* Crew pinned message template */}
          <div>
            <p className="text-xs font-medium text-text-secondary mb-2">Crew Pinned Message</p>
            <div className="relative rounded-xl border border-white/[0.06] bg-bg-elevated p-3">
              <pre className="text-[11px] text-text-secondary whitespace-pre-wrap font-mono leading-relaxed">
{`📦 SUPPLY REQUESTS — To request supplies, type:

/supply [item] [quantity] [job name]

Example: /supply trash bags 2 Lanai Living

The bot will log it and notify management.

Other commands:
/status — Today's snapshot
/ar — Outstanding invoices
/help — All commands`}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(
                  `📦 SUPPLY REQUESTS — To request supplies, type:\n\n/supply [item] [quantity] [job name]\n\nExample: /supply trash bags 2 Lanai Living\n\nThe bot will log it and notify management.\n\nOther commands:\n/status — Today's snapshot\n/ar — Outstanding invoices\n/help — All commands`
                )}
                className="absolute top-2 right-2 p-1.5 rounded-lg hover:bg-white/[0.08] text-text-tertiary hover:text-text-primary transition-colors"
                title="Copy to clipboard"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Setup instructions */}
          <div className="p-3 rounded-lg bg-bg-elevated border border-white/[0.06] text-xs text-text-secondary space-y-1.5">
            <p className="font-medium text-text-primary">Setup Steps</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Add the bot to your crew group and management group</li>
              <li>Send any message in each group — chat IDs will appear in "Detected Groups" above</li>
              <li>Copy each ID into the fields above and click Save</li>
              <li>Click <b>Register Webhook</b> to point Telegram at your Vercel URL</li>
              <li>Pin the crew message template in your crew group</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card id="notifications">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-accent-blue" />
            <CardTitle>Notifications</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Push permissions */}
          <div>
            <p className="text-xs font-medium text-text-secondary mb-3 uppercase tracking-wider">Web Push Notifications</p>
            <div className="flex items-center gap-3 flex-wrap">
              {pushPermission === 'granted' ? (
                <div className="flex items-center gap-2 text-sm text-brand-green">
                  <CheckCircle2 className="w-4 h-4" />
                  Push notifications enabled
                </div>
              ) : pushPermission === 'denied' ? (
                <div className="flex items-center gap-2 text-sm text-accent-red">
                  <BellOff className="w-4 h-4" />
                  Notifications blocked — enable in browser settings
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Bell className="w-3.5 h-3.5" />}
                  loading={requestingPush}
                  onClick={enablePushNotifications}
                >
                  Enable Push Notifications
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                loading={testingNotif}
                onClick={sendTestNotification}
              >
                Send Test
              </Button>
            </div>
            {pushResult && (
              <p className={`text-xs mt-2 ${pushResult.ok ? 'text-brand-green' : 'text-accent-red'}`}>
                {pushResult.ok ? '✓ ' : '✗ '}{pushResult.message}
              </p>
            )}
            {!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && (
              <p className="text-[11px] text-accent-amber mt-2">
                ⚠️ VAPID keys not configured — add NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL to Vercel env vars. Generate with: <code className="font-mono bg-white/[0.06] px-1 rounded">node -e "require('web-push').generateVAPIDKeys().then(console.log)"</code>
              </p>
            )}
          </div>

          {/* Telegram DM IDs */}
          <div>
            <p className="text-xs font-medium text-text-secondary mb-3 uppercase tracking-wider">Telegram DM IDs (for urgent alerts)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-text-tertiary mb-1.5 uppercase tracking-wider font-medium">Carlo's User ID</label>
                <input
                  type="text"
                  value={carloTgUserId}
                  onChange={e => setCarloTgUserId(e.target.value)}
                  placeholder="e.g. 123456789"
                  className="w-full px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-tertiary mb-1.5 uppercase tracking-wider font-medium">Jorden's User ID</label>
                <input
                  type="text"
                  value={jordenTgUserId}
                  onChange={e => setJordenTgUserId(e.target.value)}
                  placeholder="e.g. 987654321"
                  className="w-full px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>
            <p className="text-[11px] text-text-tertiary mt-1.5">Get your ID by messaging @userinfobot on Telegram</p>
          </div>

          {/* Notification categories */}
          <div>
            <p className="text-xs font-medium text-text-secondary mb-3 uppercase tracking-wider">Notification Categories</p>
            <div className="space-y-2">
              {(Object.entries(notifPrefs) as Array<[keyof typeof notifPrefs, boolean]>).map(([key, enabled]) => {
                const labels: Record<string, string> = {
                  tasks: 'Tasks — due dates, overdue, assignments',
                  financial: 'Financial — overdue invoices, AR alerts',
                  jobs: 'Jobs — margin warnings, job updates',
                  leads: 'Leads — new leads, follow-up reminders',
                  crew: 'Crew / Operations — supplies, Telegram flags',
                }
                return (
                  <div key={key} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                    <span className="text-sm text-text-secondary">{labels[key]}</span>
                    <button
                      onClick={() => setNotifPrefs(p => ({ ...p, [key]: !p[key] }))}
                      className={`relative w-9 h-5 rounded-full transition-colors ${enabled ? 'bg-brand-green' : 'bg-white/10'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-text-tertiary mt-2">Quiet hours: 9pm–7am AZ time — no urgent/high alerts during this window</p>
          </div>

          <Button
            size="sm"
            loading={savingNotifPrefs}
            icon={<Save className="w-3.5 h-3.5" />}
            onClick={saveNotifPrefs}
          >
            Save Notification Settings
          </Button>
        </CardContent>
      </Card>

      {/* Data Records — counts from DB */}
      {healthStatus && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-text-tertiary" />
              <CardTitle>Data Records</CardTitle>
            </div>
            <button
              onClick={() => {
                setLoadingHealth(true)
                fetch('/api/health').then(r => r.json()).then(setHealthStatus).catch(() => {}).finally(() => setLoadingHealth(false))
              }}
              className="text-[11px] text-accent-blue hover:underline flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${loadingHealth ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-4">
              {([
                { label: 'Clients', count: healthStatus.records.clients, color: 'text-brand-green', href: '/clients' },
                { label: 'Jobs', count: healthStatus.records.jobs, color: 'text-accent-blue', href: '/jobs' },
                { label: 'Invoices', count: healthStatus.records.invoices, color: 'text-accent-amber', href: '/financials' },
                { label: 'Leads', count: healthStatus.records.leads, color: 'text-text-primary', href: '/clients' },
                { label: 'Quo Calls', count: healthStatus.records.quo_calls, color: 'text-accent-blue', href: '/communications' },
                { label: 'Quo Msgs', count: healthStatus.records.quo_messages, color: 'text-text-secondary', href: '/communications' },
                { label: 'Employees', count: healthStatus.records.employees, color: 'text-text-secondary', href: '/team' },
                { label: 'Tasks', count: healthStatus.records.tasks, color: 'text-accent-amber', href: '/tasks' },
              ] as Array<{ label: string; count: number; color: string; href: string }>).map(({ label, count, color, href }) => (
                <a key={label} href={href} className="p-3 rounded-xl bg-bg-elevated border border-white/[0.06] text-center hover:border-white/[0.12] transition-colors">
                  <p className={`text-xl font-mono font-bold ${color}`}>{count}</p>
                  <p className="text-[10px] text-text-tertiary mt-0.5">{label}</p>
                </a>
              ))}
            </div>
            <p className="text-[10px] text-text-tertiary">
              Includes seed/demo data. Counts update after sync.
              {healthStatus.records.clients <= 10 && healthStatus.records.jobs <= 10 && (
                <span className="text-accent-amber ml-1">— Showing seed data only. Connect Jobber and sync to see real records.</span>
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Environment info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-text-tertiary" />
            <CardTitle>Environment & API Keys</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 font-mono text-xs">
            {([
              { key: 'App URL', value: process.env.NEXT_PUBLIC_APP_URL || 'localhost:3000', isUrl: true },
              { key: 'Supabase', value: process.env.NEXT_PUBLIC_SUPABASE_URL ? true : false },
              { key: 'JOBBER_CLIENT_ID', value: healthStatus?.env.JOBBER_CLIENT_ID },
              { key: 'JOBBER_CLIENT_SECRET', value: healthStatus?.env.JOBBER_CLIENT_SECRET },
              { key: 'QUO_API_KEY', value: healthStatus?.env.QUO_API_KEY },
              { key: 'TELEGRAM_BOT_TOKEN', value: healthStatus?.env.TELEGRAM_BOT_TOKEN },
              { key: 'GOOGLE_CLIENT_ID', value: healthStatus?.env.GOOGLE_CLIENT_ID },
              { key: 'GOOGLE_CLIENT_SECRET', value: healthStatus?.env.GOOGLE_CLIENT_SECRET },
              { key: 'VAPID_PRIVATE_KEY', value: healthStatus?.env.VAPID_PRIVATE_KEY },
              { key: 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', value: healthStatus?.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY },
              { key: 'ANTHROPIC_API_KEY', value: healthStatus?.env.ANTHROPIC_API_KEY },
            ] as Array<{ key: string; value: boolean | string | undefined; isUrl?: boolean }>).map(({ key, value, isUrl }) => (
              <div key={key} className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
                <span className="text-text-tertiary">{key}</span>
                <span className={
                  isUrl ? 'text-text-secondary'
                  : value === true ? 'text-brand-green'
                  : value === false ? 'text-accent-red'
                  : value === undefined ? 'text-text-tertiary'
                  : 'text-text-secondary'
                }>
                  {isUrl ? String(value) : value === true ? '✓ Set' : value === false ? '✗ Missing' : '…'}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-text-tertiary mt-3">
            Missing keys must be added in Vercel → Project → Settings → Environment Variables, then redeploy.
          </p>
        </CardContent>
      </Card>

      {/* PWA / iOS Install Instructions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-text-tertiary" />
            <CardTitle>Install as App</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3 rounded-xl bg-bg-elevated border border-white/[0.06] space-y-2">
              <p className="text-xs font-semibold text-text-primary">Android (Chrome)</p>
              <ol className="text-[11px] text-text-secondary space-y-1 list-decimal list-inside">
                <li>Open this app in Chrome</li>
                <li>Tap the ⋮ menu (top right)</li>
                <li>Tap <strong>Add to Home screen</strong></li>
                <li>Confirm — app installs with CB icon</li>
              </ol>
            </div>
            <div className="p-3 rounded-xl bg-bg-elevated border border-white/[0.06] space-y-2">
              <p className="text-xs font-semibold text-text-primary">iPhone (Safari required)</p>
              <ol className="text-[11px] text-text-secondary space-y-1 list-decimal list-inside">
                <li>Open this app in <strong>Safari</strong> (not Chrome)</li>
                <li>Tap the Share icon <span className="font-mono">⬆</span> at the bottom</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
                <li>Tap <strong>Add</strong> — CB HQ appears on your home screen</li>
              </ol>
              <p className="text-[10px] text-accent-amber">iOS does not show install banners — manual steps required</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
