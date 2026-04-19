'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, MessageSquare,
  Flag, FlagOff, ChevronDown, ChevronUp, RefreshCw, ArrowLeft,
  ArrowRight, UserPlus, ExternalLink, Clock, AlertTriangle, CheckCircle2, XCircle,
} from 'lucide-react'
import { formatDistanceToNow, isToday } from 'date-fns'
import { formatDuration, normalizePhone, QUO_MISSED_STATUSES } from '@/lib/quo'
import { buildContactMap, getDisplayInfo, CONTACT_TYPE_STYLE, type ContactMap } from '@/lib/contacts'
import type { QuoCall, QuoMessage } from '@/types'

// ── Types ──────────────────────────────────────────────────────────────────

type Filter = 'all' | 'inbound' | 'outbound' | 'missed' | 'flagged'
type TimelineItem =
  | { type: 'call'; data: QuoCall }
  | { type: 'message'; data: QuoMessage }

interface ConvertForm {
  name: string
  phone: string
  notes: string
  service_type: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getRawDisplayName(item: QuoCall | QuoMessage): string {
  if (item.contact_name) return item.contact_name
  return item.direction === 'inbound' ? item.from_number : item.to_number
}

function getExternalPhone(item: QuoCall | QuoMessage): string {
  return item.direction === 'inbound' ? item.from_number : item.to_number
}

function isMissedCall(call: QuoCall): boolean {
  return QUO_MISSED_STATUSES.has(call.status ?? '')
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CommunicationsPage() {
  const [calls, setCalls] = useState<QuoCall[]>([])
  const [messages, setMessages] = useState<QuoMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [thread, setThread] = useState<QuoMessage[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [convertForm, setConvertForm] = useState<ConvertForm>({ name: '', phone: '', notes: '', service_type: '' })
  const [converting, setConverting] = useState(false)
  const [convertedIds, setConvertedIds] = useState<Set<string>>(new Set())
  const [flagUpdating, setFlagUpdating] = useState<string | null>(null)
  const [contactMap, setContactMap] = useState<ContactMap>({})
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  const loadContactMap = useCallback(async () => {
    try {
      const [contactsRes, leadsRes, clientsRes, empRes] = await Promise.all([
        supabase.from('quo_contacts').select('id, name, phone, company').limit(500),
        supabase.from('leads').select('id, name, phone, status').limit(500),
        supabase.from('clients').select('id, name, company_name, phone').limit(500),
        supabase.from('employees').select('id, name, phone').eq('status', 'active'),
      ])
      setContactMap(buildContactMap(
        (contactsRes.data || []) as Array<{ id: string; name: string; phone: string; company?: string | null }>,
        (leadsRes.data || []) as Array<{ id: string; name: string; phone?: string | null; status?: string }>,
        (clientsRes.data || []) as Array<{ id: string; name?: string | null; company_name?: string | null; phone?: string | null }>,
        (empRes.data || []) as Array<{ id: string; name: string; phone?: string | null }>,
      ))
    } catch { /* non-critical */ }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [callsRes, messagesRes] = await Promise.all([
      supabase.from('quo_calls').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('quo_messages').select('*').order('created_at', { ascending: false }).limit(200),
    ])
    setCalls((callsRes.data ?? []) as QuoCall[])
    setMessages((messagesRes.data ?? []) as QuoMessage[])
    setLoading(false)
  }, [])

  useEffect(() => { load(); loadContactMap() }, [load, loadContactMap])

  // ── KPIs ────────────────────────────────────────────────────────────────

  const todayCalls = calls.filter(c => isToday(new Date(c.created_at)))
  const todayMessages = messages.filter(m => isToday(new Date(m.created_at)))
  const missedToday = todayCalls.filter(isMissedCall)
  const completedCalls = todayCalls.filter(c => !isMissedCall(c) && c.duration_seconds)
  const avgDuration = completedCalls.length > 0
    ? Math.round(completedCalls.reduce((s, c) => s + (c.duration_seconds ?? 0), 0) / completedCalls.length)
    : null

  const allFlagged = [
    ...calls.filter(c => c.is_flagged).map(c => ({ type: 'call' as const, data: c })),
    ...messages.filter(m => m.is_flagged).map(m => ({ type: 'message' as const, data: m })),
  ].sort((a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime())

  // ── Timeline ────────────────────────────────────────────────────────────

  const timeline: TimelineItem[] = [
    ...calls.map(c => ({ type: 'call' as const, data: c })),
    ...messages.map(m => ({ type: 'message' as const, data: m })),
  ]
    .sort((a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime())
    .filter(item => {
      if (filter === 'inbound') return item.data.direction === 'inbound'
      if (filter === 'outbound') return item.data.direction === 'outbound'
      if (filter === 'missed') return item.type === 'call' && isMissedCall(item.data as QuoCall)
      if (filter === 'flagged') return item.data.is_flagged
      return true
    })

  // ── Actions ─────────────────────────────────────────────────────────────

  async function syncNow() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/sync/quo', { method: 'POST' })
      const json = await res.json()
      if (json.success) {
        setSyncResult({ ok: true, message: `Synced ${json.synced.calls} calls · ${json.synced.messages} messages · ${json.synced.flagged} flagged` })
        await load()
      } else {
        setSyncResult({ ok: false, message: json.error || 'Sync failed' })
      }
    } catch (err) {
      setSyncResult({ ok: false, message: String(err) })
    }
    setSyncing(false)
  }

  async function toggleFlag(item: TimelineItem) {
    const id = item.data.id
    const newFlagged = !item.data.is_flagged
    setFlagUpdating(id)

    const table = item.type === 'call' ? 'quo_calls' : 'quo_messages'
    await supabase.from(table).update({ is_flagged: newFlagged, flag_reason: newFlagged ? 'Manually flagged' : null }).eq('id', id)

    if (item.type === 'call') {
      setCalls(prev => prev.map(c => c.id === id ? { ...c, is_flagged: newFlagged, flag_reason: newFlagged ? 'Manually flagged' : null } : c))
    } else {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, is_flagged: newFlagged, flag_reason: newFlagged ? 'Manually flagged' : null } : m))
    }
    setFlagUpdating(null)
  }

  function startConvert(item: TimelineItem) {
    const phone = getExternalPhone(item.data)
    const name = item.data.contact_name ?? ''
    const notes = item.type === 'call'
      ? (item.data as QuoCall).ai_summary ?? (item.data as QuoCall).flag_reason ?? ''
      : (item.data as QuoMessage).body?.slice(0, 300) ?? ''

    setConvertForm({ name, phone, notes, service_type: '' })
    setConvertingId(item.data.id)
  }

  async function submitConvert(e: React.FormEvent) {
    e.preventDefault()
    setConverting(true)
    const { data, error } = await supabase.from('leads').insert({
      name: convertForm.name,
      phone: convertForm.phone,
      service_type: convertForm.service_type || null,
      notes: convertForm.notes || null,
      source: 'manual',
      status: 'new',
    }).select().single()

    if (!error && data) {
      await supabase.from('activity_feed').insert({
        event_type: 'new_lead',
        title: `New lead from communications: ${convertForm.name}`,
        description: `Phone: ${convertForm.phone}`,
        lead_id: data.id,
      })
      setConvertedIds(prev => new Set(prev).add(convertingId!))
    }
    setConverting(false)
    setConvertingId(null)
  }

  async function expandMessage(msg: QuoMessage) {
    const id = msg.id
    if (expanded === id) { setExpanded(null); setThread([]); return }
    setExpanded(id)
    setLoadingThread(true)
    const phone = getExternalPhone(msg)
    const norm = normalizePhone(phone)
    const last7 = norm.slice(-7)
    const { data } = await supabase
      .from('quo_messages')
      .select('*')
      .or(`from_number.ilike.%${last7}%,to_number.ilike.%${last7}%`)
      .order('created_at', { ascending: true })
      .limit(50)
    setThread((data ?? []) as QuoMessage[])
    setLoadingThread(false)
  }

  // ── Render helpers ────────────────────────────────────────────────────

  function CallIcon({ call }: { call: QuoCall }) {
    if (isMissedCall(call)) return <PhoneMissed className="w-3.5 h-3.5 text-accent-red" />
    if (call.direction === 'inbound') return <PhoneIncoming className="w-3.5 h-3.5 text-accent-blue" />
    return <PhoneOutgoing className="w-3.5 h-3.5 text-brand-green" />
  }

  function callBg(call: QuoCall): string {
    if (isMissedCall(call)) return 'bg-accent-red/10'
    if (call.direction === 'inbound') return 'bg-accent-blue/10'
    return 'bg-brand-green/10'
  }

  const FILTER_TABS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'inbound', label: 'Inbound' },
    { key: 'outbound', label: 'Outbound' },
    { key: 'missed', label: 'Missed' },
    { key: 'flagged', label: `Flagged (${allFlagged.length})` },
  ]

  return (
    <div className="space-y-5 max-w-4xl">

      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Communications</h1>
          <p className="text-xs text-text-tertiary mt-0.5">Calls & messages from Quo (OpenPhone)</p>
        </div>
        <div className="flex items-center gap-2">
          {syncResult && (
            <p className={`text-[11px] font-mono ${syncResult.ok ? 'text-brand-green' : 'text-accent-red'}`}>
              {syncResult.ok ? '✓ ' : '✗ '}{syncResult.message}
            </p>
          )}
          <Button
            size="sm"
            variant="secondary"
            loading={syncing}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={syncNow}
          >
            {syncing ? 'Syncing…' : 'Sync Now'}
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: "Today's Calls",
            value: String(todayCalls.length),
            sub: `${todayCalls.filter(c => c.direction === 'inbound').length} in · ${todayCalls.filter(c => c.direction === 'outbound').length} out`,
            icon: <Phone className="w-4 h-4 text-accent-blue" />,
            bg: 'bg-accent-blue/10',
          },
          {
            label: "Today's Messages",
            value: String(todayMessages.length),
            sub: `${todayMessages.filter(m => m.direction === 'inbound').length} received`,
            icon: <MessageSquare className="w-4 h-4 text-brand-green" />,
            bg: 'bg-brand-green/10',
          },
          {
            label: 'Missed Calls',
            value: String(missedToday.length),
            sub: 'today',
            icon: <PhoneMissed className="w-4 h-4 text-accent-red" />,
            bg: 'bg-accent-red/10',
            alert: missedToday.length > 0,
          },
          {
            label: 'Avg Duration',
            value: avgDuration ? formatDuration(avgDuration) : '—',
            sub: 'completed calls today',
            icon: <Clock className="w-4 h-4 text-accent-amber" />,
            bg: 'bg-accent-amber/10',
          },
        ].map(kpi => (
          <div key={kpi.label} className={`card p-4 ${kpi.alert ? 'border-accent-red/30' : ''}`}>
            <div className={`w-8 h-8 rounded-xl ${kpi.bg} flex items-center justify-center mb-3`}>
              {kpi.icon}
            </div>
            <p className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">{kpi.label}</p>
            <p className="text-2xl font-bold font-mono text-text-primary mt-0.5">{kpi.value}</p>
            <p className="text-[11px] text-text-secondary font-mono mt-0.5">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Needs Attention section */}
      {allFlagged.length > 0 && (
        <Card className="border-accent-amber/25">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-accent-amber" />
              <CardTitle>Needs Attention — {allFlagged.length} item{allFlagged.length !== 1 ? 's' : ''}</CardTitle>
            </div>
          </CardHeader>
          <div className="divide-y divide-white/[0.04]">
            {allFlagged.slice(0, 8).filter(item => !dismissedIds.has(item.data.id)).map(item => {
              const extPhone = getExternalPhone(item.data)
              const { name: resolvedName, resolved } = getDisplayInfo(item.data.contact_name, extPhone, contactMap)
              const isConverted = convertedIds.has(item.data.id)

              return (
                <div key={item.data.id} className="px-4 py-3 flex items-start gap-3">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    item.type === 'call' ? callBg(item.data as QuoCall) : 'bg-accent-blue/10'
                  }`}>
                    {item.type === 'call'
                      ? <CallIcon call={item.data as QuoCall} />
                      : <MessageSquare className="w-3.5 h-3.5 text-accent-blue" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-text-primary">{resolvedName}</span>
                      {resolved && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${CONTACT_TYPE_STYLE[resolved.type].color}`}>
                          {resolved.context ?? CONTACT_TYPE_STYLE[resolved.type].label}
                        </span>
                      )}
                      <Badge variant="amber" dot>{item.data.flag_reason ?? 'Flagged'}</Badge>
                    </div>
                    {item.type === 'call' && (item.data as QuoCall).ai_summary && (
                      <p className="text-xs text-text-secondary mt-0.5 line-clamp-1">{(item.data as QuoCall).ai_summary}</p>
                    )}
                    {item.type === 'message' && (item.data as QuoMessage).body && (
                      <p className="text-xs text-text-secondary mt-0.5 line-clamp-1">{(item.data as QuoMessage).body}</p>
                    )}
                    <p className="text-[10px] text-text-tertiary mt-1 font-mono">
                      {formatDistanceToNow(new Date(item.data.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {isConverted ? (
                      <span className="flex items-center gap-1 text-[11px] text-brand-green">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Converted
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<UserPlus className="w-3 h-3" />}
                        onClick={() => startConvert(item)}
                      >
                        Convert to Lead
                      </Button>
                    )}
                    <button
                      onClick={() => toggleFlag(item)}
                      disabled={flagUpdating === item.data.id}
                      className="p-1.5 rounded-lg hover:bg-white/[0.06] text-text-tertiary hover:text-accent-amber transition-colors"
                      title="Unflag"
                    >
                      <FlagOff className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDismissedIds(prev => new Set(prev).add(item.data.id))}
                      className="p-1.5 rounded-lg hover:bg-accent-red/10 text-text-tertiary hover:text-accent-red transition-colors"
                      title="Dismiss"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Convert to Lead form */}
      {convertingId && (
        <Card className="border-accent-blue/25">
          <CardHeader>
            <CardTitle>Convert to Lead</CardTitle>
            <button onClick={() => setConvertingId(null)} className="text-xs text-text-tertiary hover:text-text-primary">✕ Cancel</button>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitConvert} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-text-tertiary mb-1.5 uppercase tracking-wider font-medium">Name *</label>
                  <input
                    required
                    value={convertForm.name}
                    onChange={e => setConvertForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full px-3 py-2 text-sm"
                    placeholder="Contact name"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-text-tertiary mb-1.5 uppercase tracking-wider font-medium">Phone</label>
                  <input
                    value={convertForm.phone}
                    onChange={e => setConvertForm(p => ({ ...p, phone: e.target.value }))}
                    className="w-full px-3 py-2 text-sm font-mono"
                    placeholder="+1 (602) 555-0000"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-text-tertiary mb-1.5 uppercase tracking-wider font-medium">Service Type</label>
                  <input
                    value={convertForm.service_type}
                    onChange={e => setConvertForm(p => ({ ...p, service_type: e.target.value }))}
                    className="w-full px-3 py-2 text-sm"
                    placeholder="e.g. Post-Construction Clean"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-text-tertiary mb-1.5 uppercase tracking-wider font-medium">Notes (pre-filled from call)</label>
                <textarea
                  value={convertForm.notes}
                  onChange={e => setConvertForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full px-3 py-2 text-sm"
                  rows={3}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" loading={converting} icon={<UserPlus className="w-3.5 h-3.5" />}>
                  {converting ? 'Creating lead…' : 'Create Lead'}
                </Button>
                <a href="/clients" className="text-xs text-accent-blue hover:underline">View lead pipeline →</a>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filter bar + timeline */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1 flex-wrap">
            {FILTER_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === tab.key
                    ? 'bg-brand-blue/10 text-brand-blue'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-text-tertiary">{timeline.length} items</p>
        </CardHeader>

        {loading ? (
          <div className="px-4 py-8 text-center text-xs text-text-tertiary">Loading…</div>
        ) : timeline.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-text-secondary">No {filter !== 'all' ? filter + ' ' : ''}communications found</p>
            <p className="text-xs text-text-tertiary mt-1">Click "Sync Now" to pull from Quo</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {timeline.map(item => {
              const isExpanded = expanded === item.data.id
              const extPhone = getExternalPhone(item.data)
              const { name: resolvedName, resolved } = getDisplayInfo(item.data.contact_name, extPhone, contactMap)
              const isConverted = convertedIds.has(item.data.id)

              if (item.type === 'call') {
                const call = item.data as QuoCall
                const missed = isMissedCall(call)

                return (
                  <div key={call.id} className={isExpanded ? 'bg-bg-elevated/30' : ''}>
                    <button
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-bg-elevated/20 transition-colors text-left"
                      onClick={() => setExpanded(isExpanded ? null : call.id)}
                    >
                      <div className={`w-8 h-8 rounded-xl ${callBg(call)} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <CallIcon call={call} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-text-primary">{resolvedName}</span>
                          {resolved && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${CONTACT_TYPE_STYLE[resolved.type].color}`}>
                              {resolved.context ?? CONTACT_TYPE_STYLE[resolved.type].label}
                            </span>
                          )}
                          {call.direction === 'inbound'
                            ? <ArrowLeft className="w-3 h-3 text-accent-blue flex-shrink-0" />
                            : <ArrowRight className="w-3 h-3 text-brand-green flex-shrink-0" />
                          }
                          {missed && <Badge variant="red">Missed</Badge>}
                          {call.ai_tags?.slice(0, 3).map(tag => (
                            <Badge key={tag} variant="gray">{tag}</Badge>
                          ))}
                          {call.is_flagged && <Flag className="w-3 h-3 text-accent-amber flex-shrink-0" />}
                        </div>
                        {call.ai_summary ? (
                          <p className={`text-xs text-text-secondary mt-0.5 ${isExpanded ? '' : 'line-clamp-1'}`}>{call.ai_summary}</p>
                        ) : missed ? (
                          <p className="text-xs text-text-tertiary mt-0.5">Missed — no answer</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                        <span className="text-[11px] text-text-tertiary font-mono">{formatDuration(call.duration_seconds)}</span>
                        <span className="text-[10px] text-text-tertiary font-mono">
                          {formatDistanceToNow(new Date(call.created_at), { addSuffix: true })}
                        </span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-text-tertiary" /> : <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />}
                      </div>
                    </button>

                    {/* Expanded call view */}
                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-4 border-t border-white/[0.04]">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3">
                          {/* Call metadata */}
                          <div className="space-y-1 text-xs font-mono">
                            <div className="flex justify-between">
                              <span className="text-text-tertiary">Direction</span>
                              <span className="text-text-primary capitalize">{call.direction}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-text-tertiary">Duration</span>
                              <span className="text-text-primary">{formatDuration(call.duration_seconds)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-text-tertiary">Status</span>
                              <span className={`capitalize ${missed ? 'text-accent-red' : 'text-brand-green'}`}>{call.status ?? '—'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-text-tertiary">From</span>
                              <span className="text-text-secondary">{call.from_number}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-text-tertiary">To</span>
                              <span className="text-text-secondary">{call.to_number}</span>
                            </div>
                            {call.client_id && (
                              <div className="flex justify-between">
                                <span className="text-text-tertiary">Client</span>
                                <a href="/clients" className="text-accent-blue hover:underline flex items-center gap-1">
                                  {call.contact_name} <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="space-y-2">
                            {call.recording_url && (
                              <div>
                                <p className="text-[11px] text-text-tertiary mb-1.5 uppercase tracking-wider font-medium">Recording</p>
                                <audio controls src={call.recording_url} className="w-full h-8" style={{ filter: 'invert(0.8) hue-rotate(180deg)' }} />
                              </div>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => toggleFlag({ type: 'call', data: call })}
                                disabled={flagUpdating === call.id}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                                  call.is_flagged
                                    ? 'bg-accent-amber/10 text-accent-amber hover:bg-accent-amber/20'
                                    : 'bg-white/[0.05] text-text-secondary hover:bg-white/10'
                                }`}
                              >
                                {call.is_flagged ? <FlagOff className="w-3 h-3" /> : <Flag className="w-3 h-3" />}
                                {call.is_flagged ? 'Unflag' : 'Flag'}
                              </button>
                              {isConverted ? (
                                <span className="flex items-center gap-1 text-[11px] text-brand-green px-3 py-1.5">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Lead created
                                </span>
                              ) : (
                                <button
                                  onClick={() => startConvert({ type: 'call', data: call })}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors"
                                >
                                  <UserPlus className="w-3 h-3" />
                                  Convert to Lead
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* AI summary */}
                        {call.ai_summary && (
                          <div>
                            <p className="text-[11px] text-text-tertiary mb-1.5 uppercase tracking-wider font-medium">AI Summary</p>
                            <p className="text-sm text-text-secondary p-3 rounded-lg bg-accent-blue/5 border border-accent-blue/10 leading-relaxed">{call.ai_summary}</p>
                          </div>
                        )}

                        {/* Flag reason */}
                        {call.is_flagged && call.flag_reason && (
                          <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-amber/5 border border-accent-amber/15">
                            <AlertTriangle className="w-3.5 h-3.5 text-accent-amber flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-accent-amber">{call.flag_reason}</p>
                          </div>
                        )}

                        {/* Transcript */}
                        {call.transcript && (
                          <div>
                            <p className="text-[11px] text-text-tertiary mb-1.5 uppercase tracking-wider font-medium">Transcript</p>
                            <pre className="text-xs text-text-secondary p-3 rounded-lg bg-bg-elevated border border-white/[0.06] whitespace-pre-wrap font-sans leading-relaxed max-h-60 overflow-y-auto">
                              {call.transcript}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              }

              // ── Message entry ──────────────────────────────────────────
              const msg = item.data as QuoMessage

              return (
                <div key={msg.id} className={isExpanded ? 'bg-bg-elevated/30' : ''}>
                  <button
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-bg-elevated/20 transition-colors text-left"
                    onClick={() => expandMessage(msg)}
                  >
                    <div className="w-8 h-8 rounded-xl bg-accent-blue/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <MessageSquare className="w-3.5 h-3.5 text-accent-blue" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary">{resolvedName}</span>
                        {resolved && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${CONTACT_TYPE_STYLE[resolved.type].color}`}>
                            {resolved.context ?? CONTACT_TYPE_STYLE[resolved.type].label}
                          </span>
                        )}
                        {msg.direction === 'inbound'
                          ? <ArrowLeft className="w-3 h-3 text-accent-blue flex-shrink-0" />
                          : <ArrowRight className="w-3 h-3 text-brand-green flex-shrink-0" />
                        }
                        {msg.is_flagged && <Flag className="w-3 h-3 text-accent-amber flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-text-secondary mt-0.5 line-clamp-1">{msg.body ?? '(no content)'}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                      <span className="text-[10px] text-text-tertiary font-mono">
                        {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                      </span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-text-tertiary" /> : <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />}
                    </div>
                  </button>

                  {/* Expanded thread */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-white/[0.04]">
                      <div className="flex items-center justify-between pt-3 mb-3">
                        <p className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">Thread with {resolvedName}</p>
                        <div className="flex items-center gap-2">
                          {isConverted ? (
                            <span className="flex items-center gap-1 text-[11px] text-brand-green">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Lead created
                            </span>
                          ) : (
                            <button
                              onClick={() => startConvert({ type: 'message', data: msg })}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors"
                            >
                              <UserPlus className="w-3 h-3" /> Convert to Lead
                            </button>
                          )}
                          <button
                            onClick={() => toggleFlag({ type: 'message', data: msg })}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${msg.is_flagged ? 'text-accent-amber' : 'text-text-tertiary hover:text-accent-amber'}`}
                          >
                            {msg.is_flagged ? <FlagOff className="w-3 h-3" /> : <Flag className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>

                      {loadingThread ? (
                        <p className="text-xs text-text-tertiary py-4 text-center">Loading thread…</p>
                      ) : (
                        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                          {thread.map(m => (
                            <div
                              key={m.id}
                              className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                            >
                              <div className={`max-w-[80%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                                m.direction === 'outbound'
                                  ? 'bg-brand-green/15 text-text-primary rounded-br-sm'
                                  : 'bg-white/[0.06] text-text-secondary rounded-bl-sm'
                              }`}>
                                <p>{m.body ?? '(media)'}</p>
                                <p className="text-[9px] text-text-tertiary mt-1 font-mono">
                                  {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
