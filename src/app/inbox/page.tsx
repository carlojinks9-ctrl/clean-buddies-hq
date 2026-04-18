'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/components/ui/Toast'
import {
  Phone, MessageSquare, Mail, Globe, Zap, AlertTriangle,
  Clock, CheckCircle2, ChevronRight, RefreshCw, Filter,
  ArrowUpRight, UserPlus, XCircle, Bell, BellOff,
  Flame, ListChecks, BarChart2,
} from 'lucide-react'
import { formatDistanceToNow, format, isPast, parseISO, isToday, isTomorrow } from 'date-fns'
import { clsx } from 'clsx'

// ── Types ──────────────────────────────────────────────────────────────────

type InboundSource = 'quo_call' | 'quo_message' | 'gmail' | 'instantly' | 'ghl' | 'manual'

interface InboundItem {
  id: string
  source: InboundSource
  source_id: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  company: string | null
  subject: string | null
  body_preview: string | null
  urgency: 'high' | 'medium' | 'low'
  tags: string[]
  status: 'new' | 'viewed' | 'actioned' | 'snoozed' | 'closed'
  sla_deadline: string | null
  sla_breached: boolean
  sla_rule: string | null
  lead_id: string | null
  task_id: string | null
  created_at: string
  updated_at: string
}

// Raw Quo shapes used for augmenting the inbox
interface QuoMissedCall {
  id: string
  from_number: string
  contact_name: string | null
  status: string
  duration_seconds: number | null
  is_flagged: boolean
  flag_reason: string | null
  ai_tags: string[] | null
  created_at: string
}

interface QuoInboundMessage {
  id: string
  from_number: string
  contact_name: string | null
  body: string | null
  is_flagged: boolean
  flag_reason: string | null
  created_at: string
}

// Unified display type
type DisplayItem = {
  id: string
  _key: string  // unique key for React
  source: InboundSource
  source_id: string | null
  contact: string
  company: string | null
  phone: string | null
  email: string | null
  subject: string
  preview: string | null
  urgency: 'high' | 'medium' | 'low'
  tags: string[]
  status: 'new' | 'viewed' | 'actioned' | 'snoozed' | 'closed'
  sla_deadline: string | null
  sla_breached: boolean
  lead_id: string | null
  created_at: string
  // for inbound_items
  item_id?: string
}

const SOURCE_META: Record<InboundSource, { label: string; icon: typeof Phone; color: string; bg: string }> = {
  quo_call:    { label: 'Quo Call',    icon: Phone,          color: 'text-accent-amber', bg: 'bg-accent-amber/10' },
  quo_message: { label: 'Quo Text',    icon: MessageSquare,  color: 'text-accent-blue',  bg: 'bg-accent-blue/10' },
  gmail:       { label: 'Gmail',       icon: Mail,           color: 'text-accent-red',   bg: 'bg-accent-red/10' },
  instantly:   { label: 'Instantly',   icon: Zap,            color: 'text-brand-green',  bg: 'bg-brand-green/10' },
  ghl:         { label: 'Website Form',icon: Globe,          color: 'text-accent-blue',  bg: 'bg-accent-blue/10' },
  manual:      { label: 'Manual',      icon: UserPlus,       color: 'text-text-tertiary', bg: 'bg-white/5' },
}

const URGENCY_META = {
  high:   { label: 'High',   color: 'text-accent-red',   dot: 'bg-accent-red' },
  medium: { label: 'Med',    color: 'text-accent-amber', dot: 'bg-accent-amber' },
  low:    { label: 'Low',    color: 'text-text-tertiary',dot: 'bg-text-tertiary' },
}

type FilterSource = 'all' | InboundSource | 'breached' | 'actioned'
type InboxMode = 'inbox' | 'hot_leads' | 'followup'

interface HotLead {
  id: string
  name: string
  company: string | null
  source: string
  urgency: 'high' | 'medium' | 'low'
  status: string
  estimated_value_cents: number | null
  next_action: string | null
  next_action_due: string | null
  owner: string | null
  tags: string[]
  last_activity_at: string | null
  created_at: string
}

// ── SLA Timer ─────────────────────────────────────────────────────────────

function SlaTimer({ deadline, breached }: { deadline: string | null; breached: boolean }) {
  if (!deadline) return null
  const isBreached = breached || isPast(parseISO(deadline))
  const dist = formatDistanceToNow(parseISO(deadline), { addSuffix: true })

  return (
    <span className={clsx(
      'inline-flex items-center gap-1 text-[10px] font-mono font-semibold',
      isBreached ? 'text-accent-red' : 'text-accent-amber'
    )}>
      <Clock className="w-2.5 h-2.5" />
      {isBreached ? `SLA breached ${dist}` : `Due ${dist}`}
    </span>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function InboxPage() {
  const [mode, setMode] = useState<InboxMode>('inbox')
  const [items, setItems] = useState<DisplayItem[]>([])
  const [hotLeads, setHotLeads] = useState<HotLead[]>([])
  const [followUpLeads, setFollowUpLeads] = useState<HotLead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterSource>('all')
  const [syncing, setSyncing] = useState(false)
  const [lastCheck, setLastCheck] = useState<string | null>(null)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [showActioned, setShowActioned] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch from all sources in parallel
      const [inboundRes, quoCallsRes, quoMsgsRes] = await Promise.all([
        supabase
          .from('inbound_items')
          .select('*')
          .not('status', 'eq', 'closed')
          .order('created_at', { ascending: false })
          .limit(200),

        supabase
          .from('quo_calls')
          .select('id, from_number, contact_name, status, duration_seconds, is_flagged, flag_reason, ai_tags, created_at')
          .eq('direction', 'inbound')
          .in('status', ['missed', 'no-answer', 'voicemail', 'busy'])
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(50),

        supabase
          .from('quo_messages')
          .select('id, from_number, contact_name, body, is_flagged, flag_reason, created_at')
          .eq('direction', 'inbound')
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(100),
      ])

      const inboundItems: InboundItem[] = (inboundRes.data || []) as InboundItem[]
      const quoCalls: QuoMissedCall[] = (quoCallsRes.data || []) as QuoMissedCall[]
      const quoMsgs: QuoInboundMessage[] = (quoMsgsRes.data || []) as QuoInboundMessage[]

      // Build set of source_ids already in inbound_items (to avoid duplicates)
      const coveredCallIds = new Set(
        inboundItems.filter(i => i.source === 'quo_call' && i.source_id).map(i => i.source_id!)
      )
      const coveredMsgIds = new Set(
        inboundItems.filter(i => i.source === 'quo_message' && i.source_id).map(i => i.source_id!)
      )

      const displayItems: DisplayItem[] = []

      // 1. inbound_items (GHL, Instantly, any manually added)
      for (const item of inboundItems) {
        const meta = SOURCE_META[item.source] || SOURCE_META.manual
        displayItems.push({
          id: item.id,
          _key: `item_${item.id}`,
          source: item.source,
          source_id: item.source_id,
          contact: item.contact_name ?? item.phone ?? item.email ?? 'Unknown',
          company: item.company,
          phone: item.phone,
          email: item.email,
          subject: item.subject ?? meta.label,
          preview: item.body_preview,
          urgency: item.urgency,
          tags: item.tags || [],
          status: item.status,
          sla_deadline: item.sla_deadline,
          sla_breached: item.sla_breached,
          lead_id: item.lead_id,
          created_at: item.created_at,
          item_id: item.id,
        })
      }

      // 2. Quo missed calls not yet in inbound_items
      for (const call of quoCalls) {
        if (coveredCallIds.has(call.id)) continue
        const threshold = 10  // default SLA minutes
        const slaDeadline = new Date(new Date(call.created_at).getTime() + threshold * 60_000).toISOString()
        const minAgo = Math.floor((Date.now() - new Date(call.created_at).getTime()) / 60_000)

        displayItems.push({
          id: call.id,
          _key: `quo_call_${call.id}`,
          source: 'quo_call',
          source_id: call.id,
          contact: call.contact_name ?? call.from_number,
          company: null,
          phone: call.from_number,
          email: null,
          subject: `Missed call — ${call.status}`,
          preview: call.flag_reason ?? (minAgo > threshold ? `⚠ SLA: callback overdue by ${minAgo - threshold}m` : `Missed ${minAgo}m ago — needs callback`),
          urgency: 'high' as const,
          tags: ['missed-call', 'callback-needed', ...(call.ai_tags || [])],
          status: 'new' as const,
          sla_deadline: slaDeadline,
          sla_breached: minAgo > threshold,
          lead_id: null,
          created_at: call.created_at,
        })
      }

      // 3. Quo inbound messages not yet in inbound_items
      for (const msg of quoMsgs) {
        if (coveredMsgIds.has(msg.id)) continue
        const threshold = 30
        const slaDeadline = new Date(new Date(msg.created_at).getTime() + threshold * 60_000).toISOString()
        const minAgo = Math.floor((Date.now() - new Date(msg.created_at).getTime()) / 60_000)

        displayItems.push({
          id: msg.id,
          _key: `quo_msg_${msg.id}`,
          source: 'quo_message',
          source_id: msg.id,
          contact: msg.contact_name ?? msg.from_number,
          company: null,
          phone: msg.from_number,
          email: null,
          subject: `Text from ${msg.contact_name ?? msg.from_number}`,
          preview: msg.body ? msg.body.slice(0, 150) : null,
          urgency: (msg.is_flagged ? 'high' : minAgo > threshold ? 'high' : 'medium') as any,
          tags: ['inbound-text', ...(msg.is_flagged ? ['flagged'] : [])],
          status: 'new' as const,
          sla_deadline: slaDeadline,
          sla_breached: minAgo > threshold,
          lead_id: null,
          created_at: msg.created_at,
        })
      }

      // Sort: breached first, then by urgency, then by recency
      const urgencyOrder = { high: 0, medium: 1, low: 2 }
      displayItems.sort((a, b) => {
        if (a.sla_breached !== b.sla_breached) return a.sla_breached ? -1 : 1
        if (urgencyOrder[a.urgency] !== urgencyOrder[b.urgency]) return urgencyOrder[a.urgency] - urgencyOrder[b.urgency]
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })

      setItems(displayItems)
    } catch (err) {
      console.error('[inbox] load error:', err)
      toast('Failed to load inbox', 'error')
    }
    setLoading(false)
  }, [])

  const loadLeads = useCallback(async () => {
    setLeadsLoading(true)
    try {
      const { data } = await supabase
        .from('leads')
        .select('id, name, company, source, urgency, status, estimated_value_cents, next_action, next_action_due, owner, tags, last_activity_at, created_at')
        .not('status', 'in', '("won","lost")')
        .order('created_at', { ascending: false })
        .limit(200)

      const leads = (data || []) as HotLead[]
      const urgencyRank = { high: 0, medium: 1, low: 2 }

      // Hot leads: all active, sorted by urgency then estimated value
      const sorted = [...leads].sort((a, b) => {
        const ua = urgencyRank[a.urgency] ?? 2
        const ub = urgencyRank[b.urgency] ?? 2
        if (ua !== ub) return ua - ub
        return (b.estimated_value_cents || 0) - (a.estimated_value_cents || 0)
      })
      setHotLeads(sorted)

      // Follow-up queue: next_action_due in past or today, not won/lost
      const followUp = leads.filter(l => {
        if (!l.next_action_due) return false
        const due = parseISO(l.next_action_due)
        return isPast(due) || isToday(due) || isTomorrow(due)
      }).sort((a, b) => {
        const da = a.next_action_due ? parseISO(a.next_action_due).getTime() : Infinity
        const db = b.next_action_due ? parseISO(b.next_action_due).getTime() : Infinity
        return da - db
      })
      setFollowUpLeads(followUp)
    } catch (err) {
      console.error('[inbox] leads load error:', err)
    }
    setLeadsLoading(false)
  }, [])

  useEffect(() => {
    load()
    loadLeads()
    // Load last SLA check time
    supabase.from('app_settings').select('value').eq('key', 'last_sla_check').maybeSingle()
      .then(({ data }) => { if (data) setLastCheck(data.value) })
  }, [load, loadLeads])

  async function runSlaCheck() {
    setSyncing(true)
    try {
      const res = await fetch('/api/sla/check', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        toast(`SLA check: ${data.new_breaches} breach${data.new_breaches !== 1 ? 'es' : ''} · ${data.alerts_sent} alert${data.alerts_sent !== 1 ? 's' : ''} sent`)
        setLastCheck(new Date().toISOString())
        await load()
      } else {
        toast(data.error || 'SLA check failed', 'error')
      }
    } catch (err) {
      toast(String(err), 'error')
    }
    setSyncing(false)
  }

  async function syncSources() {
    setSyncing(true)
    try {
      await Promise.allSettled([
        fetch('/api/sync/ghl', { method: 'POST' }),
        fetch('/api/sync/instantly', { method: 'POST' }),
      ])
      await load()
      toast('Sources synced')
    } catch (err) {
      toast(String(err), 'error')
    }
    setSyncing(false)
  }

  async function markActioned(item: DisplayItem) {
    if (!item.item_id) return  // Quo items not yet in inbound_items — can't action directly
    setActioningId(item.item_id)
    const { error } = await supabase
      .from('inbound_items')
      .update({ status: 'actioned', actioned_at: new Date().toISOString() })
      .eq('id', item.item_id)
    setActioningId(null)
    if (error) {
      toast(`Update failed: ${error.message}`, 'error')
    } else {
      setItems(prev => prev.map(i => i.item_id === item.item_id ? { ...i, status: 'actioned' } : i))
      toast('Marked as actioned')
    }
  }

  async function closeItem(item: DisplayItem) {
    if (!item.item_id) return
    await supabase.from('inbound_items').update({ status: 'closed' }).eq('id', item.item_id)
    setItems(prev => prev.filter(i => i.item_id !== item.item_id))
  }

  async function createLead(item: DisplayItem) {
    if (item.lead_id) {
      window.location.href = `/clients`
      return
    }
    const { data, error } = await supabase
      .from('leads')
      .insert({
        name: item.contact,
        email: item.email,
        phone: item.phone,
        company: item.company,
        status: 'new',
        source: item.source === 'quo_call' || item.source === 'quo_message' ? 'quo' : item.source,
        urgency: item.urgency,
        owner: 'carlo',
        next_action: 'Follow up with lead',
        next_action_due: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        pipeline_stage: 'new',
        last_activity_at: new Date().toISOString(),
        tags: item.tags,
      })
      .select('id')
      .single()

    if (error) {
      toast(`Lead creation failed: ${error.message}`, 'error')
      return
    }

    // Link inbound item to lead
    if (item.item_id) {
      await supabase.from('inbound_items').update({ lead_id: data.id }).eq('id', item.item_id)
    }
    setItems(prev => prev.map(i => i._key === item._key ? { ...i, lead_id: data.id } : i))
    toast('Lead created')
  }

  // ── Filtering ───────────────────────────────────────────────────────────

  const activeItems = items.filter(i => i.status !== 'actioned' && i.status !== 'closed')
  const actionedItems = items.filter(i => i.status === 'actioned')

  const filteredItems = (showActioned ? actionedItems : activeItems).filter(item => {
    if (filter === 'all') return true
    if (filter === 'breached') return item.sla_breached
    if (filter === 'actioned') return item.status === 'actioned'
    return item.source === filter
  })

  const breachCount = activeItems.filter(i => i.sla_breached).length
  const urgentCount = activeItems.filter(i => i.urgency === 'high').length

  const sourceCounts: Record<string, number> = {}
  for (const item of activeItems) {
    sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1
  }

  const FILTER_TABS: Array<{ key: FilterSource; label: string; count?: number }> = [
    { key: 'all',         label: 'All',          count: activeItems.length },
    { key: 'breached',    label: 'SLA Breached', count: breachCount },
    { key: 'quo_call',    label: 'Missed Calls', count: sourceCounts['quo_call'] || 0 },
    { key: 'quo_message', label: 'Texts',        count: sourceCounts['quo_message'] || 0 },
    { key: 'ghl',         label: 'Website Forms',count: sourceCounts['ghl'] || 0 },
    { key: 'instantly',   label: 'Instantly',    count: sourceCounts['instantly'] || 0 },
    { key: 'gmail',       label: 'Gmail',        count: sourceCounts['gmail'] || 0 },
  ]

  // ── Item Row ────────────────────────────────────────────────────────────

  function ItemRow({ item }: { item: DisplayItem }) {
    const meta = SOURCE_META[item.source] || SOURCE_META.manual
    const Icon = meta.icon
    const urgencyMeta = URGENCY_META[item.urgency]
    const isActioned = item.status === 'actioned'
    const isBreached = item.sla_breached || (item.sla_deadline ? isPast(parseISO(item.sla_deadline)) : false)

    return (
      <div className={clsx(
        'group flex items-start gap-3 px-4 py-3.5 border-b border-white/[0.04] last:border-0 transition-colors',
        isActioned ? 'opacity-50' : 'hover:bg-white/[0.02]',
        isBreached && !isActioned && 'bg-accent-red/[0.02] border-l-2 border-l-accent-red/40',
      )}>
        {/* Source icon */}
        <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5', meta.bg)}>
          <Icon className={clsx('w-4 h-4', meta.color)} />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-text-primary truncate">
                  {item.contact}
                </span>
                {item.company && (
                  <span className="text-[11px] text-text-tertiary truncate">— {item.company}</span>
                )}
                <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', urgencyMeta.dot)} title={urgencyMeta.label} />
              </div>

              <p className="text-[12px] text-text-secondary mt-0.5 truncate">{item.subject}</p>

              {item.preview && (
                <p className="text-[11px] text-text-tertiary mt-0.5 truncate">{item.preview}</p>
              )}

              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge variant={
                  item.source === 'ghl' ? 'blue'
                    : item.source === 'instantly' ? 'green'
                    : item.source === 'quo_call' ? 'amber'
                    : item.source === 'quo_message' ? 'blue'
                    : 'gray'
                } className="text-[10px]">
                  {meta.label}
                </Badge>

                {item.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.05] text-text-tertiary">
                    {tag}
                  </span>
                ))}

                {isBreached && !isActioned && (
                  <span className="text-[10px] font-semibold text-accent-red flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5" /> SLA
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-[10px] text-text-tertiary font-mono">
                  {formatDistanceToNow(parseISO(item.created_at), { addSuffix: true })}
                </span>
                {item.sla_deadline && <SlaTimer deadline={item.sla_deadline} breached={isBreached} />}
                {item.lead_id && (
                  <span className="text-[10px] text-brand-green flex items-center gap-1">
                    <CheckCircle2 className="w-2.5 h-2.5" /> Lead created
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className={clsx(
              'flex items-center gap-1.5 flex-shrink-0',
              'opacity-0 group-hover:opacity-100 sm:opacity-100 transition-opacity'
            )}>
              {!item.lead_id && (
                <button
                  onClick={() => createLead(item)}
                  className="p-1.5 rounded-lg bg-brand-green/10 hover:bg-brand-green/20 text-brand-green transition-colors"
                  title="Create lead"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                </button>
              )}
              {item.lead_id && (
                <a
                  href="/clients"
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-text-secondary transition-colors"
                  title="View lead"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </a>
              )}
              {!isActioned && item.item_id && (
                <button
                  onClick={() => markActioned(item)}
                  disabled={actioningId === item.item_id}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-brand-green/10 text-text-tertiary hover:text-brand-green transition-colors"
                  title="Mark actioned"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </button>
              )}
              {item.item_id && (
                <button
                  onClick={() => closeItem(item)}
                  className="p-1.5 rounded-lg hover:bg-accent-red/10 text-text-tertiary hover:text-accent-red transition-colors"
                  title="Dismiss"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-text-primary">Inbound Command Center</h1>
            {urgentCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-accent-red/15 text-accent-red text-[11px] font-bold">
                {urgentCount} urgent
              </span>
            )}
          </div>
          <p className="text-[12px] text-text-tertiary mt-0.5">
            {activeItems.length} active · {breachCount} SLA breached · {actionedItems.length} actioned
            {lastCheck && (
              <span className="ml-2 opacity-60">
                · SLA check {formatDistanceToNow(parseISO(lastCheck), { addSuffix: true })}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className={clsx('w-3.5 h-3.5', syncing && 'animate-spin')} />}
            onClick={syncSources}
            loading={syncing}
          >
            Sync Sources
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Bell className="w-3.5 h-3.5" />}
            onClick={runSlaCheck}
            loading={syncing}
          >
            Check SLAs
          </Button>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="flex items-center gap-1 p-1 bg-bg-surface rounded-xl border border-white/[0.06] w-fit">
        {([
          { key: 'inbox',     label: 'Inbox',         icon: Bell,       badge: activeItems.length },
          { key: 'hot_leads', label: 'Hot Leads',     icon: Flame,      badge: hotLeads.filter(l => l.urgency === 'high').length },
          { key: 'followup',  label: 'Follow-Up Queue', icon: ListChecks, badge: followUpLeads.filter(l => l.next_action_due && isPast(parseISO(l.next_action_due))).length },
        ] as Array<{ key: InboxMode; label: string; icon: typeof Bell; badge: number }>).map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setMode(tab.key)}
              className={clsx(
                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                mode === tab.key ? 'bg-white/10 text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.badge > 0 && (
                <span className={clsx(
                  'text-[10px] font-mono px-1.5 py-0.5 rounded-md',
                  tab.key === 'inbox' && tab.badge > 0 ? 'bg-accent-red/15 text-accent-red' : 'bg-white/[0.08] text-text-tertiary'
                )}>{tab.badge}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* SLA Breach Alert */}
      {mode === 'inbox' && breachCount > 0 && !showActioned && (
        <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-accent-red flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-accent-red">
              {breachCount} SLA breach{breachCount !== 1 ? 'es' : ''} — response overdue
            </p>
            <p className="text-[11px] text-accent-red/70 mt-0.5">
              These items missed their response window. Action immediately or escalate.
            </p>
          </div>
          <button
            onClick={() => setFilter('breached')}
            className="text-[11px] text-accent-red font-semibold hover:underline flex-shrink-0"
          >
            View all →
          </button>
        </div>
      )}

      {/* ── Inbox Mode ──────────────────────────────────────────────────── */}
      {mode === 'inbox' && (<>
        {/* Filter tabs */}
        <div className="flex items-center gap-1 flex-wrap">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => { setFilter(tab.key); setShowActioned(false) }}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5',
                filter === tab.key && !showActioned
                  ? tab.key === 'breached'
                    ? 'bg-accent-red/15 text-accent-red border border-accent-red/25'
                    : 'bg-white/10 text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
              )}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className={clsx(
                  'text-[10px] font-mono px-1.5 py-0.5 rounded-md',
                  tab.key === 'breached' && tab.count > 0 ? 'bg-accent-red/15 text-accent-red' : 'bg-white/[0.08] text-text-tertiary'
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button
            onClick={() => { setShowActioned(p => !p); setFilter('all') }}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5',
              showActioned ? 'bg-white/10 text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
            )}
          >
            <CheckCircle2 className="w-3 h-3" />
            Actioned ({actionedItems.length})
          </button>
        </div>

        {/* Main list */}
        <div className="rounded-2xl border border-white/[0.06] bg-bg-surface overflow-hidden">
          {loading ? (
            <div className="divide-y divide-white/[0.04]">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-4 py-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="h-3 w-3/5" />
                    <Skeleton className="h-2.5 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-16 text-center">
              {showActioned ? (
                <>
                  <CheckCircle2 className="w-8 h-8 text-brand-green mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-text-secondary font-medium">No actioned items</p>
                  <p className="text-[12px] text-text-tertiary mt-1">Items you action will appear here</p>
                </>
              ) : filter === 'breached' ? (
                <>
                  <CheckCircle2 className="w-8 h-8 text-brand-green mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-text-secondary font-medium">No SLA breaches</p>
                  <p className="text-[12px] text-text-tertiary mt-1">All items are within response window</p>
                </>
              ) : (
                <>
                  <BellOff className="w-8 h-8 text-text-tertiary mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-text-secondary font-medium">Inbox clear</p>
                  <p className="text-[12px] text-text-tertiary mt-1 mb-4">
                    {filter === 'all' ? 'No new inbound items from any source' : `No items from ${SOURCE_META[filter as InboundSource]?.label ?? filter}`}
                  </p>
                  <Button size="sm" variant="secondary" onClick={syncSources} loading={syncing}>
                    Sync Sources
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {filteredItems.map(item => <ItemRow key={item._key} item={item} />)}
            </div>
          )}
        </div>

        {/* Source status summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {(Object.entries(SOURCE_META) as Array<[InboundSource, typeof SOURCE_META[InboundSource]]>)
            .filter(([key]) => key !== 'manual')
            .map(([source, meta]) => {
            const Icon = meta.icon
            const count = sourceCounts[source] || 0
            return (
              <div
                key={source}
                className={clsx(
                  'p-3 rounded-xl border cursor-pointer transition-colors',
                  filter === source && !showActioned
                    ? 'border-brand-green/30 bg-brand-green/5'
                    : 'border-white/[0.06] bg-bg-elevated hover:border-white/[0.10]'
                )}
                onClick={() => { setFilter(source); setShowActioned(false) }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={clsx('w-6 h-6 rounded-md flex items-center justify-center', meta.bg)}>
                    <Icon className={clsx('w-3.5 h-3.5', meta.color)} />
                  </div>
                  <span className="text-[11px] text-text-tertiary font-medium">{meta.label}</span>
                </div>
                <p className="text-xl font-mono font-bold text-text-primary">{count}</p>
                <p className="text-[10px] text-text-tertiary mt-0.5">active</p>
              </div>
            )
          })}
        </div>

        {/* Setup hints for unconfigured sources */}
        <SetupHints />
      </>)}

      {/* ── Hot Leads Mode ──────────────────────────────────────────────── */}
      {mode === 'hot_leads' && (
        <HotLeadsBoard leads={hotLeads} loading={leadsLoading} />
      )}

      {/* ── Follow-Up Queue Mode ─────────────────────────────────────────── */}
      {mode === 'followup' && (
        <FollowUpQueue leads={followUpLeads} loading={leadsLoading} />
      )}
    </div>
  )
}

// ── Hot Leads Board ────────────────────────────────────────────────────────

const SOURCE_COLOR: Record<string, string> = {
  ghl: 'text-accent-blue', instantly: 'text-brand-green',
  quo: 'text-accent-amber', gmail: 'text-accent-red',
  jobber: 'text-text-tertiary', referral: 'text-accent-blue', manual: 'text-text-tertiary',
}
const SOURCE_LABEL: Record<string, string> = {
  ghl: 'GHL', instantly: 'Instantly', quo: 'Quo',
  gmail: 'Gmail', jobber: 'Jobber', referral: 'Ref', manual: 'Manual',
}

function HotLeadsBoard({ leads, loading }: { leads: HotLead[]; loading: boolean }) {
  if (loading) return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-white/[0.06] bg-bg-surface px-4 py-3">
          <Skeleton className="h-3.5 w-1/3 mb-2" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
  if (leads.length === 0) return (
    <div className="py-16 text-center rounded-2xl border border-white/[0.06] bg-bg-surface">
      <Flame className="w-8 h-8 text-text-tertiary mx-auto mb-3 opacity-50" />
      <p className="text-sm text-text-secondary">No active leads</p>
      <p className="text-[12px] text-text-tertiary mt-1">Leads from Inbox will appear here</p>
    </div>
  )
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-tertiary px-1">{leads.length} active leads — sorted by urgency + value</p>
      {leads.map(lead => {
        const urgencyDot = lead.urgency === 'high' ? 'bg-accent-red' : lead.urgency === 'medium' ? 'bg-accent-amber' : 'bg-text-tertiary'
        const srcColor = SOURCE_COLOR[lead.source] || 'text-text-tertiary'
        const srcLabel = SOURCE_LABEL[lead.source] || lead.source
        const isOverdue = lead.next_action_due ? isPast(parseISO(lead.next_action_due)) : false
        return (
          <div key={lead.id} className={clsx(
            'rounded-xl border bg-bg-surface px-4 py-3 flex items-start gap-3',
            isOverdue ? 'border-accent-red/30' : 'border-white/[0.06]'
          )}>
            <span className={clsx('w-2 h-2 rounded-full flex-shrink-0 mt-1.5', urgencyDot)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-text-primary">{lead.name}</span>
                {lead.company && <span className="text-[11px] text-text-tertiary">— {lead.company}</span>}
                <span className={clsx('text-[10px] font-mono', srcColor)}>{srcLabel}</span>
                {lead.owner && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-text-secondary capitalize">{lead.owner}</span>
                )}
              </div>
              {lead.next_action && (
                <p className={clsx('text-[11px] mt-1', isOverdue ? 'text-accent-red' : 'text-text-tertiary')}>
                  <Clock className="w-3 h-3 inline mr-1" />
                  {lead.next_action}
                  {lead.next_action_due && (
                    <span className="ml-1 font-mono opacity-70">
                      · {isOverdue ? 'overdue' : formatDistanceToNow(parseISO(lead.next_action_due), { addSuffix: true })}
                    </span>
                  )}
                </p>
              )}
              {lead.tags && lead.tags.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-1.5">
                  {lead.tags.slice(0, 4).map(t => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-text-tertiary">{t}</span>
                  ))}
                </div>
              )}
            </div>
            {lead.estimated_value_cents ? (
              <span className="text-sm font-mono font-bold text-brand-green flex-shrink-0">
                ${(lead.estimated_value_cents / 100).toLocaleString()}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// ── Follow-Up Queue ────────────────────────────────────────────────────────

function FollowUpQueue({ leads, loading }: { leads: HotLead[]; loading: boolean }) {
  if (loading) return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-white/[0.06] bg-bg-surface px-4 py-3">
          <Skeleton className="h-3.5 w-1/3 mb-2" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
  if (leads.length === 0) return (
    <div className="py-16 text-center rounded-2xl border border-white/[0.06] bg-bg-surface">
      <ListChecks className="w-8 h-8 text-brand-green mx-auto mb-3 opacity-50" />
      <p className="text-sm text-text-secondary font-medium">Follow-up queue is clear</p>
      <p className="text-[12px] text-text-tertiary mt-1">No leads due for follow-up today or tomorrow</p>
    </div>
  )

  const overdue = leads.filter(l => l.next_action_due && isPast(parseISO(l.next_action_due)))
  const today = leads.filter(l => l.next_action_due && !isPast(parseISO(l.next_action_due)) && isToday(parseISO(l.next_action_due)))
  const tomorrow = leads.filter(l => l.next_action_due && isTomorrow(parseISO(l.next_action_due)))

  function LeadRow({ lead, isOverdue }: { lead: HotLead; isOverdue: boolean }) {
    const srcColor = SOURCE_COLOR[lead.source] || 'text-text-tertiary'
    const srcLabel = SOURCE_LABEL[lead.source] || lead.source
    return (
      <div className={clsx(
        'rounded-xl border bg-bg-surface px-4 py-3',
        isOverdue ? 'border-accent-red/30 bg-accent-red/[0.02]' : 'border-white/[0.06]'
      )}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-text-primary">{lead.name}</span>
              {lead.company && <span className="text-[11px] text-text-tertiary">— {lead.company}</span>}
              <span className={clsx('text-[10px] font-mono', srcColor)}>{srcLabel}</span>
              {lead.owner && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-text-secondary capitalize">{lead.owner}</span>
              )}
            </div>
            {lead.next_action && (
              <p className={clsx('text-[12px] mt-1 font-medium', isOverdue ? 'text-accent-red' : 'text-text-secondary')}>
                {lead.next_action}
              </p>
            )}
            {lead.next_action_due && (
              <p className={clsx('text-[11px] mt-0.5 font-mono', isOverdue ? 'text-accent-red/70' : 'text-text-tertiary')}>
                {isOverdue
                  ? `Overdue · was due ${formatDistanceToNow(parseISO(lead.next_action_due), { addSuffix: true })}`
                  : `Due ${format(parseISO(lead.next_action_due), 'h:mm a')}`
                }
              </p>
            )}
          </div>
          {lead.estimated_value_cents ? (
            <span className="text-sm font-mono font-bold text-brand-green flex-shrink-0">
              ${(lead.estimated_value_cents / 100).toLocaleString()}
            </span>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {overdue.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-accent-red uppercase tracking-wider px-1 mb-2">
            Overdue ({overdue.length})
          </p>
          <div className="space-y-2">
            {overdue.map(l => <LeadRow key={l.id} lead={l} isOverdue />)}
          </div>
        </div>
      )}
      {today.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-accent-amber uppercase tracking-wider px-1 mb-2">
            Today ({today.length})
          </p>
          <div className="space-y-2">
            {today.map(l => <LeadRow key={l.id} lead={l} isOverdue={false} />)}
          </div>
        </div>
      )}
      {tomorrow.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider px-1 mb-2">
            Tomorrow ({tomorrow.length})
          </p>
          <div className="space-y-2">
            {tomorrow.map(l => <LeadRow key={l.id} lead={l} isOverdue={false} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function SetupHints() {
  const ghlToken = typeof window !== 'undefined' ? false : false  // server-side check not possible in client
  return (
    <div className="rounded-xl border border-white/[0.06] bg-bg-surface p-4">
      <p className="text-xs font-semibold text-text-secondary mb-3 uppercase tracking-wider">Source Status</p>
      <div className="space-y-2 text-[11px]">
        <SourceStatusRow
          source="Quo (OpenPhone)"
          description="Missed calls + texts via webhook"
          settingsPath="/settings"
          checkEnvKey="quo_configured"
        />
        <SourceStatusRow
          source="Go High Level (Website Forms)"
          description="Form submissions via GHL_PRIVATE_INTEGRATION_TOKEN + GHL_LOCATION_ID"
          settingsPath="/settings"
          checkEnvKey="ghl_configured"
        />
        <SourceStatusRow
          source="Instantly"
          description="Outbound reply monitoring via INSTANTLY_API_KEY"
          settingsPath="/settings"
          checkEnvKey="instantly_configured"
        />
        <SourceStatusRow
          source="Gmail"
          description="Important emails via Google OAuth"
          settingsPath="/settings"
          checkEnvKey="gmail_configured"
        />
      </div>
    </div>
  )
}

function SourceStatusRow({ source, description, settingsPath }: {
  source: string; description: string; settingsPath: string; checkEnvKey: string
}) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'missing'>('loading')
  const [lastSync, setLastSync] = useState<string | null>(null)

  useEffect(() => {
    const keyMap: Record<string, string> = {
      'Quo (OpenPhone)': 'last_quo_sync',
      'Go High Level (Website Forms)': 'last_ghl_sync',
      'Instantly': 'last_instantly_sync',
      'Gmail': 'last_google_sync',
    }
    const key = keyMap[source]
    if (key) {
      supabase.from('app_settings').select('value').eq('key', key).maybeSingle()
        .then(({ data }) => {
          if (data?.value) {
            setLastSync(data.value)
            setStatus('ok')
          } else {
            setStatus('missing')
          }
        })
    } else {
      setStatus('missing')
    }
  }, [source])

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
      <div className="flex items-center gap-2">
        <span className={clsx(
          'w-1.5 h-1.5 rounded-full flex-shrink-0',
          status === 'loading' ? 'bg-text-tertiary animate-pulse'
            : status === 'ok' ? 'bg-brand-green'
            : 'bg-accent-amber'
        )} />
        <div>
          <span className="text-text-secondary font-medium">{source}</span>
          <span className="text-text-tertiary ml-2">{description}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 text-[10px] flex-shrink-0">
        {lastSync ? (
          <span className="text-text-tertiary font-mono">
            synced {formatDistanceToNow(parseISO(lastSync), { addSuffix: true })}
          </span>
        ) : (
          <span className="text-accent-amber">not synced</span>
        )}
        <a href={settingsPath} className="text-accent-blue hover:underline">Setup →</a>
      </div>
    </div>
  )
}
