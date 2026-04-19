'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/components/ui/Toast'
import {
  Phone, MessageSquare, Mail, Globe, Zap, AlertTriangle,
  Clock, CheckCircle2, RefreshCw, UserPlus, XCircle, Bell,
  BellOff, Flame, ListChecks, ChevronDown, ChevronUp,
  Ban, Briefcase, ShoppingBag, X, MoreHorizontal,
} from 'lucide-react'
import { formatDistanceToNow, format, isPast, parseISO, isToday, isTomorrow } from 'date-fns'
import { clsx } from 'clsx'
import { buildContactMap, getDisplayInfo, CONTACT_TYPE_STYLE, phoneKey, type ContactMap } from '@/lib/contacts'

// ── Types ──────────────────────────────────────────────────────────────────

type InboundSource = 'quo_call' | 'quo_message' | 'gmail' | 'instantly' | 'ghl' | 'manual'

interface InboundItem {
  id: string; source: InboundSource; source_id: string | null
  contact_name: string | null; phone: string | null; email: string | null; company: string | null
  subject: string | null; body_preview: string | null
  urgency: 'high' | 'medium' | 'low'; tags: string[]
  status: 'new' | 'viewed' | 'actioned' | 'snoozed' | 'closed'
  sla_deadline: string | null; sla_breached: boolean; sla_rule: string | null
  lead_id: string | null; task_id: string | null
  created_at: string; updated_at: string
}

interface QuoMissedCall {
  id: string; from_number: string; contact_name: string | null
  status: string; duration_seconds: number | null; is_flagged: boolean
  flag_reason: string | null; ai_tags: string[] | null; created_at: string
}

interface QuoInboundMessage {
  id: string; from_number: string; contact_name: string | null
  body: string | null; is_flagged: boolean; flag_reason: string | null; created_at: string
}

type DisplayItem = {
  id: string; _key: string; source: InboundSource; source_id: string | null
  contact: string; company: string | null; phone: string | null; email: string | null
  subject: string; preview: string | null; urgency: 'high' | 'medium' | 'low'
  tags: string[]; status: 'new' | 'viewed' | 'actioned' | 'snoozed' | 'closed'
  sla_deadline: string | null; sla_breached: boolean; lead_id: string | null
  created_at: string; item_id?: string
  // Thread grouping (for repeated missed calls from same number)
  _threadCount?: number
  _threadIds?: string[]  // source_ids of all calls in thread
}

type Classification = 'spam' | 'recruiting' | 'vendor' | 'not-a-lead' | 'wrong-number'

const CLASSIFICATION_META: Record<Classification, { label: string; icon: React.ReactNode; tag: string }> = {
  'spam':         { label: 'Spam',          icon: <Ban className="w-3 h-3" />,         tag: 'spam' },
  'wrong-number': { label: 'Wrong number',  icon: <Phone className="w-3 h-3" />,       tag: 'wrong-number' },
  'recruiting':   { label: 'Recruiting',    icon: <Briefcase className="w-3 h-3" />,   tag: 'recruiting' },
  'vendor':       { label: 'Vendor',        icon: <ShoppingBag className="w-3 h-3" />, tag: 'vendor' },
  'not-a-lead':   { label: 'Not a lead',    icon: <XCircle className="w-3 h-3" />,     tag: 'not-a-lead' },
}

const SOURCE_META: Record<InboundSource, { label: string; icon: typeof Phone; color: string; bg: string }> = {
  quo_call:    { label: 'Quo Call',     icon: Phone,         color: 'text-accent-amber', bg: 'bg-accent-amber/10' },
  quo_message: { label: 'Quo Text',     icon: MessageSquare, color: 'text-accent-blue',  bg: 'bg-accent-blue/10' },
  gmail:       { label: 'Gmail',        icon: Mail,          color: 'text-accent-red',   bg: 'bg-accent-red/10' },
  instantly:   { label: 'Instantly',    icon: Zap,           color: 'text-brand-green',  bg: 'bg-brand-green/10' },
  ghl:         { label: 'Website Form', icon: Globe,         color: 'text-accent-blue',  bg: 'bg-accent-blue/10' },
  manual:      { label: 'Manual',       icon: UserPlus,      color: 'text-text-tertiary', bg: 'bg-bg-elevated' },
}

type InboxMode = 'inbox' | 'hot_leads' | 'followup'
type FilterSource = 'all' | InboundSource | 'breached' | 'actioned'

interface HotLead {
  id: string; name: string; company: string | null; source: string
  urgency: 'high' | 'medium' | 'low'; status: string
  estimated_value_cents: number | null; next_action: string | null
  next_action_due: string | null; owner: string | null; tags: string[]
  last_activity_at: string | null; created_at: string
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

// ── Classification dropdown ────────────────────────────────────────────────

function ClassifyMenu({
  onClassify,
  onClose,
}: {
  onClassify: (c: Classification) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute right-0 top-8 z-50 w-44 rounded-xl border border-subtle bg-bg-surface shadow-xl shadow-black/30 overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-subtle">
        <p className="text-[10px] text-text-tertiary font-semibold uppercase tracking-wider">Classify & dismiss</p>
      </div>
      {(Object.entries(CLASSIFICATION_META) as Array<[Classification, typeof CLASSIFICATION_META[Classification]]>).map(([key, meta]) => (
        <button
          key={key}
          onClick={() => { onClassify(key); onClose() }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors text-left"
        >
          <span className="text-text-tertiary">{meta.icon}</span>
          {meta.label}
        </button>
      ))}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function InboxPage() {
  const [mode, setMode] = useState<InboxMode>('inbox')
  const [items, setItems] = useState<DisplayItem[]>([])
  const [hotLeads, setHotLeads] = useState<HotLead[]>([])
  const [followUpLeads, setFollowUpLeads] = useState<HotLead[]>([])
  const [contactMap, setContactMap] = useState<ContactMap>({})
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterSource>('all')
  const [syncing, setSyncing] = useState(false)
  const [lastCheck, setLastCheck] = useState<string | null>(null)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [showActioned, setShowActioned] = useState(false)
  const [classifyMenuId, setClassifyMenuId] = useState<string | null>(null)

  // ── Load contact resolution map ──────────────────────────────────────────

  const loadContactMap = useCallback(async () => {
    try {
      const [contactsRes, leadsRes, clientsRes, empRes] = await Promise.all([
        supabase.from('quo_contacts').select('id, name, phone, company').limit(500),
        supabase.from('leads').select('id, name, phone, status').limit(500),
        supabase.from('clients').select('id, name, company_name, phone').limit(500),
        supabase.from('employees').select('id, name, phone').eq('status', 'active'),
      ])
      const map = buildContactMap(
        (contactsRes.data || []) as Array<{ id: string; name: string; phone: string; company?: string | null }>,
        (leadsRes.data || []) as Array<{ id: string; name: string; phone?: string | null; status?: string }>,
        (clientsRes.data || []) as Array<{ id: string; name?: string | null; company_name?: string | null; phone?: string | null }>,
        (empRes.data || []) as Array<{ id: string; name: string; phone?: string | null }>,
      )
      setContactMap(map)
    } catch (err: unknown) {
      console.error('[inbox] contact map error:', err)
    }
  }, [])

  // ── Load inbox items ──────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
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
          .limit(100),

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

      const coveredCallIds = new Set(
        inboundItems.filter(i => i.source === 'quo_call' && i.source_id).map(i => i.source_id!)
      )
      const coveredMsgIds = new Set(
        inboundItems.filter(i => i.source === 'quo_message' && i.source_id).map(i => i.source_id!)
      )

      const displayItems: DisplayItem[] = []

      // 1. inbound_items (GHL, Instantly, manually added)
      for (const item of inboundItems) {
        displayItems.push({
          id: item.id, _key: `item_${item.id}`,
          source: item.source, source_id: item.source_id,
          contact: item.contact_name ?? item.phone ?? item.email ?? 'Unknown',
          company: item.company, phone: item.phone, email: item.email,
          subject: item.subject ?? SOURCE_META[item.source]?.label ?? 'Inbound',
          preview: item.body_preview, urgency: item.urgency, tags: item.tags || [],
          status: item.status, sla_deadline: item.sla_deadline,
          sla_breached: item.sla_breached, lead_id: item.lead_id,
          created_at: item.created_at, item_id: item.id,
        })
      }

      // 2. Quo missed calls — thread-group by phone number
      const callGroups = new Map<string, QuoMissedCall[]>()
      for (const call of quoCalls) {
        if (coveredCallIds.has(call.id)) continue
        const key = phoneKey(call.from_number)
        const group = callGroups.get(key) || []
        group.push(call)
        callGroups.set(key, group)
      }

      for (const [, group] of Array.from(callGroups.entries())) {
        // Sort group by most recent first
        group.sort((a: QuoMissedCall, b: QuoMissedCall) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        const latest = group[0]
        const threshold = 10
        const slaDeadline = new Date(new Date(latest.created_at).getTime() + threshold * 60_000).toISOString()
        const minAgo = Math.floor((Date.now() - new Date(latest.created_at).getTime()) / 60_000)
        const isBreached = minAgo > threshold

        const contactName = latest.contact_name ?? latest.from_number
        const subject = group.length > 1
          ? `${group.length} missed calls`
          : `Missed call — ${latest.status}`
        const preview = group.length > 1
          ? `Latest: ${formatDistanceToNow(new Date(latest.created_at), { addSuffix: true })} · ${group.length} unanswered`
          : (latest.flag_reason ?? (isBreached ? `⚠ Callback overdue by ${minAgo - threshold}m` : `Missed ${minAgo}m ago`))

        displayItems.push({
          id: latest.id,
          _key: `quo_call_${latest.from_number}_grp`,
          source: 'quo_call', source_id: latest.id,
          contact: contactName, company: null,
          phone: latest.from_number, email: null,
          subject, preview,
          urgency: 'high' as const,
          tags: ['missed-call', 'callback-needed', ...(latest.ai_tags || [])],
          status: 'new' as const,
          sla_deadline: slaDeadline, sla_breached: isBreached,
          lead_id: null, created_at: latest.created_at,
          _threadCount: group.length > 1 ? group.length : undefined,
          _threadIds: group.map(c => c.id),
        })
      }

      // 3. Quo inbound messages (not yet in inbound_items)
      // Deduplicate by phone — only show latest per phone in the last 7 days
      const msgGroups = new Map<string, QuoInboundMessage[]>()
      for (const msg of quoMsgs) {
        if (coveredMsgIds.has(msg.id)) continue
        const key = phoneKey(msg.from_number)
        const group = msgGroups.get(key) || []
        group.push(msg)
        msgGroups.set(key, group)
      }

      for (const [, group] of Array.from(msgGroups.entries())) {
        group.sort((a: QuoInboundMessage, b: QuoInboundMessage) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        const latest = group[0]
        const threshold = 30
        const slaDeadline = new Date(new Date(latest.created_at).getTime() + threshold * 60_000).toISOString()
        const minAgo = Math.floor((Date.now() - new Date(latest.created_at).getTime()) / 60_000)

        displayItems.push({
          id: latest.id,
          _key: `quo_msg_${latest.from_number}_grp`,
          source: 'quo_message', source_id: latest.id,
          contact: latest.contact_name ?? latest.from_number,
          company: null, phone: latest.from_number, email: null,
          subject: group.length > 1
            ? `${group.length} texts from ${latest.contact_name ?? latest.from_number}`
            : `Text from ${latest.contact_name ?? latest.from_number}`,
          preview: latest.body ? latest.body.slice(0, 150) : null,
          urgency: (latest.is_flagged ? 'high' : minAgo > threshold ? 'high' : 'medium') as 'high' | 'medium',
          tags: ['inbound-text', ...(latest.is_flagged ? ['flagged'] : [])],
          status: 'new' as const,
          sla_deadline: slaDeadline,
          sla_breached: minAgo > threshold,
          lead_id: null, created_at: latest.created_at,
          _threadCount: group.length > 1 ? group.length : undefined,
        })
      }

      // Sort: breached → urgency → recency
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
      const sorted = [...leads].sort((a, b) => {
        const ua = urgencyRank[a.urgency as keyof typeof urgencyRank] ?? 2
        const ub = urgencyRank[b.urgency as keyof typeof urgencyRank] ?? 2
        if (ua !== ub) return ua - ub
        return (b.estimated_value_cents || 0) - (a.estimated_value_cents || 0)
      })
      setHotLeads(sorted)

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
    loadContactMap()
    supabase.from('app_settings').select('value').eq('key', 'last_sla_check').maybeSingle()
      .then(({ data }) => { if (data) setLastCheck(data.value) })
  }, [load, loadLeads, loadContactMap])

  // ── Actions ───────────────────────────────────────────────────────────────

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
    } catch (err) { toast(String(err), 'error') }
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
    } catch (err) { toast(String(err), 'error') }
    setSyncing(false)
  }

  async function markActioned(item: DisplayItem) {
    if (!item.item_id) return
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
      toast('Marked handled')
    }
  }

  async function dismissItem(item: DisplayItem) {
    if (item.item_id) {
      await supabase.from('inbound_items').update({ status: 'closed' }).eq('id', item.item_id)
    }
    setItems(prev => prev.filter(i => i._key !== item._key))
  }

  async function classifyItem(item: DisplayItem, classification: Classification) {
    const tag = CLASSIFICATION_META[classification].tag
    if (item.item_id) {
      await supabase.from('inbound_items').update({
        status: 'closed',
        tags: [...(item.tags || []).filter(t => !Object.values(CLASSIFICATION_META).map(m => m.tag).includes(t)), tag],
      }).eq('id', item.item_id)
    } else {
      // Raw Quo item — create an inbound_item record and close it
      await supabase.from('inbound_items').insert({
        source: item.source,
        source_id: item.source_id,
        contact_name: item.contact,
        phone: item.phone,
        urgency: item.urgency,
        status: 'closed',
        tags: [tag],
        subject: item.subject,
      })
    }
    setItems(prev => prev.filter(i => i._key !== item._key))
    toast(`Marked as ${tag}`)
  }

  async function createLead(item: DisplayItem) {
    if (item.lead_id) { window.location.href = '/clients'; return }
    const { data, error } = await supabase
      .from('leads')
      .insert({
        name: item.contact, email: item.email, phone: item.phone,
        company: item.company, status: 'new',
        source: item.source === 'quo_call' || item.source === 'quo_message' ? 'quo' : item.source,
        urgency: item.urgency, owner: 'carlo',
        next_action: 'Follow up', next_action_due: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        pipeline_stage: 'new', last_activity_at: new Date().toISOString(), tags: item.tags,
      })
      .select('id').single()
    if (error) { toast(`Lead creation failed: ${error.message}`, 'error'); return }
    if (item.item_id) {
      await supabase.from('inbound_items').update({ lead_id: data.id }).eq('id', item.item_id)
    }
    setItems(prev => prev.map(i => i._key === item._key ? { ...i, lead_id: data.id } : i))
    toast('Lead created')
  }

  // ── Filtering ─────────────────────────────────────────────────────────────

  const activeItems = items.filter(i => i.status !== 'actioned' && i.status !== 'closed')
  const actionedItems = items.filter(i => i.status === 'actioned')
  const breachCount = activeItems.filter(i => i.sla_breached).length
  const urgentCount = activeItems.filter(i => i.urgency === 'high').length

  const filteredItems = (showActioned ? actionedItems : activeItems).filter(item => {
    if (filter === 'all') return true
    if (filter === 'breached') return item.sla_breached
    if (filter === 'actioned') return item.status === 'actioned'
    return item.source === filter
  })

  const sourceCounts: Record<string, number> = {}
  for (const item of activeItems) {
    sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1
  }

  const FILTER_TABS: Array<{ key: FilterSource; label: string; count?: number }> = [
    { key: 'all',         label: 'All',           count: activeItems.length },
    { key: 'breached',    label: 'SLA Breached',  count: breachCount },
    { key: 'quo_call',    label: 'Missed Calls',  count: sourceCounts['quo_call'] || 0 },
    { key: 'quo_message', label: 'Texts',         count: sourceCounts['quo_message'] || 0 },
    { key: 'ghl',         label: 'Website Forms', count: sourceCounts['ghl'] || 0 },
    { key: 'instantly',   label: 'Instantly',     count: sourceCounts['instantly'] || 0 },
  ]

  // ── Item Row ──────────────────────────────────────────────────────────────

  function ItemRow({ item }: { item: DisplayItem }) {
    const meta = SOURCE_META[item.source] || SOURCE_META.manual
    const Icon = meta.icon
    const isActioned = item.status === 'actioned'
    const isBreached = item.sla_breached || (item.sla_deadline ? isPast(parseISO(item.sla_deadline)) : false)
    const showClassifyMenu = classifyMenuId === item._key

    // Apply contact resolution
    const { name: resolvedName, resolved } = getDisplayInfo(
      item.contact !== item.phone ? item.contact : null,
      item.phone,
      contactMap,
    )

    const classificationTags = item.tags.filter(t =>
      Object.values(CLASSIFICATION_META).map(m => m.tag).includes(t)
    )

    return (
      <div className={clsx(
        'group relative flex gap-3 px-4 py-3.5 border-b border-subtle last:border-0 transition-colors',
        isActioned ? 'opacity-50' : 'hover:bg-bg-elevated/40',
        isBreached && !isActioned && 'bg-accent-red/[0.02] border-l-2 border-l-accent-red/40 pl-3.5',
      )}>
        {/* Source icon */}
        <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5', meta.bg)}>
          <Icon className={clsx('w-4 h-4', meta.color)} />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Row 1: Contact + badges */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold text-text-primary">
                  {resolvedName}
                </span>
                {resolved && (
                  <span className={clsx(
                    'text-[10px] px-1.5 py-0.5 rounded-md font-medium',
                    CONTACT_TYPE_STYLE[resolved.type].color
                  )}>
                    {resolved.context ?? CONTACT_TYPE_STYLE[resolved.type].label}
                  </span>
                )}
                {item._threadCount && item._threadCount > 1 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-accent-red/10 text-accent-red font-semibold">
                    ×{item._threadCount}
                  </span>
                )}
                {item.company && !resolved && (
                  <span className="text-[11px] text-text-tertiary truncate">— {item.company}</span>
                )}
              </div>

              {/* Row 2: Subject + preview */}
              <p className="text-[12px] text-text-secondary mt-0.5 truncate">{item.subject}</p>
              {item.preview && (
                <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-2 sm:line-clamp-1">{item.preview}</p>
              )}

              {/* Row 3: Tags + time + SLA */}
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
                {classificationTags.map(tag => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-md bg-accent-amber/10 text-accent-amber capitalize">
                    {tag}
                  </span>
                ))}
                {isBreached && !isActioned && (
                  <span className="text-[10px] font-semibold text-accent-red flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5" /> SLA
                  </span>
                )}
                {item.lead_id && (
                  <span className="text-[10px] text-brand-green flex items-center gap-1">
                    <CheckCircle2 className="w-2.5 h-2.5" /> Lead
                  </span>
                )}
                <span className="text-[10px] text-text-tertiary font-mono">
                  {formatDistanceToNow(parseISO(item.created_at), { addSuffix: true })}
                </span>
                {item.sla_deadline && <SlaTimer deadline={item.sla_deadline} breached={isBreached} />}
              </div>
            </div>

            {/* Action buttons — always visible on mobile, hover on desktop */}
            <div className={clsx(
              'flex items-center gap-1 flex-shrink-0',
              'sm:opacity-0 sm:group-hover:opacity-100 transition-opacity'
            )}>
              {!item.lead_id && (
                <button
                  onClick={() => createLead(item)}
                  className="p-1.5 rounded-lg bg-brand-blue/10 hover:bg-brand-blue/20 text-brand-blue transition-colors"
                  title="Create lead"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                </button>
              )}
              {!isActioned && item.item_id && (
                <button
                  onClick={() => markActioned(item)}
                  disabled={actioningId === item.item_id}
                  className="p-1.5 rounded-lg bg-bg-elevated hover:bg-brand-green/10 text-text-tertiary hover:text-brand-green transition-colors"
                  title="Mark handled"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </button>
              )}
              {/* Classify + dismiss dropdown */}
              <div className="relative">
                <button
                  onClick={() => setClassifyMenuId(showClassifyMenu ? null : item._key)}
                  className="p-1.5 rounded-lg hover:bg-bg-elevated text-text-tertiary hover:text-text-secondary transition-colors"
                  title="Classify / dismiss"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
                {showClassifyMenu && (
                  <ClassifyMenu
                    onClassify={(c) => classifyItem(item, c)}
                    onClose={() => setClassifyMenuId(null)}
                  />
                )}
              </div>
              <button
                onClick={() => dismissItem(item)}
                className="p-1.5 rounded-lg hover:bg-accent-red/10 text-text-tertiary hover:text-accent-red transition-colors"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

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
          <Button variant="ghost" size="sm"
            icon={<RefreshCw className={clsx('w-3.5 h-3.5', syncing && 'animate-spin')} />}
            onClick={syncSources} loading={syncing}>
            Sync
          </Button>
          <Button variant="secondary" size="sm"
            icon={<Bell className="w-3.5 h-3.5" />}
            onClick={runSlaCheck} loading={syncing}>
            Check SLAs
          </Button>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="flex items-center gap-1 p-1 bg-bg-surface rounded-xl border border-subtle w-fit overflow-x-auto">
        {([
          { key: 'inbox',    label: 'Inbox',        icon: Bell,       badge: activeItems.length },
          { key: 'hot_leads',label: 'Hot Leads',    icon: Flame,      badge: hotLeads.filter(l => l.urgency === 'high').length },
          { key: 'followup', label: 'Follow-Up',    icon: ListChecks, badge: followUpLeads.filter(l => l.next_action_due && isPast(parseISO(l.next_action_due))).length },
        ] as Array<{ key: InboxMode; label: string; icon: typeof Bell; badge: number }>).map(tab => {
          const Icon = tab.icon
          return (
            <button key={tab.key} onClick={() => setMode(tab.key)}
              className={clsx(
                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                mode === tab.key ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'
              )}>
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.badge > 0 && (
                <span className={clsx(
                  'text-[10px] font-mono px-1.5 py-0.5 rounded-md',
                  tab.key === 'inbox' ? 'bg-accent-red/15 text-accent-red' : 'bg-bg-elevated text-text-tertiary'
                )}>{tab.badge}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* SLA breach alert */}
      {mode === 'inbox' && breachCount > 0 && !showActioned && (
        <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-accent-red flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-accent-red">
              {breachCount} SLA breach{breachCount !== 1 ? 'es' : ''}
            </p>
          </div>
          <button onClick={() => setFilter('breached')}
            className="text-[11px] text-accent-red font-semibold hover:underline flex-shrink-0">
            View →
          </button>
        </div>
      )}

      {/* Inbox mode */}
      {mode === 'inbox' && (<>
        {/* Filter tabs */}
        <div className="flex items-center gap-1 flex-wrap">
          {FILTER_TABS.map(tab => (
            <button key={tab.key}
              onClick={() => { setFilter(tab.key); setShowActioned(false) }}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5',
                filter === tab.key && !showActioned
                  ? tab.key === 'breached'
                    ? 'bg-accent-red/15 text-accent-red border border-accent-red/25'
                    : 'bg-bg-elevated text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
              )}>
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className={clsx(
                  'text-[10px] font-mono px-1 rounded',
                  tab.key === 'breached' ? 'text-accent-red' : 'text-text-tertiary'
                )}>{tab.count}</span>
              )}
            </button>
          ))}
          <div className="w-px h-4 bg-subtle mx-1" />
          <button
            onClick={() => { setShowActioned(p => !p); setFilter('all') }}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5',
              showActioned ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-elevated'
            )}>
            <CheckCircle2 className="w-3 h-3" />
            Handled ({actionedItems.length})
          </button>
        </div>

        {/* Item list */}
        <div className="rounded-2xl border border-subtle bg-bg-surface overflow-hidden">
          {loading ? (
            <div className="divide-y divide-subtle">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-4 py-4 flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-bg-elevated flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-2/5" /><Skeleton className="h-3 w-3/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-16 text-center">
              {showActioned ? (
                <>
                  <CheckCircle2 className="w-8 h-8 text-brand-green mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-text-secondary">No handled items</p>
                </>
              ) : (
                <>
                  <BellOff className="w-8 h-8 text-text-tertiary mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-text-secondary font-medium">Inbox clear</p>
                  <p className="text-[12px] text-text-tertiary mt-1 mb-4">No active items from any source</p>
                  <Button size="sm" variant="secondary" onClick={syncSources} loading={syncing}>
                    Sync Sources
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div>
              {filteredItems.map(item => <ItemRow key={item._key} item={item} />)}
            </div>
          )}
        </div>
      </>)}

      {mode === 'hot_leads' && <HotLeadsBoard leads={hotLeads} loading={leadsLoading} />}
      {mode === 'followup' && <FollowUpQueue leads={followUpLeads} loading={leadsLoading} />}
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
  if (loading) return <div className="space-y-2">{Array.from({length: 4}).map((_,i) => (
    <div key={i} className="rounded-xl border border-subtle bg-bg-surface px-4 py-3">
      <Skeleton className="h-3.5 w-1/3 mb-2" /><Skeleton className="h-3 w-1/2" />
    </div>
  ))}</div>
  if (leads.length === 0) return (
    <div className="py-16 text-center rounded-2xl border border-subtle bg-bg-surface">
      <Flame className="w-8 h-8 text-text-tertiary mx-auto mb-3 opacity-50" />
      <p className="text-sm text-text-secondary">No active leads</p>
    </div>
  )
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-tertiary px-1">{leads.length} active — sorted by urgency + value</p>
      {leads.map(lead => {
        const urgencyDot = lead.urgency === 'high' ? 'bg-accent-red' : lead.urgency === 'medium' ? 'bg-accent-amber' : 'bg-text-tertiary'
        const isOverdue = lead.next_action_due ? isPast(parseISO(lead.next_action_due)) : false
        return (
          <div key={lead.id} className={clsx(
            'rounded-xl border bg-bg-surface px-4 py-3 flex items-start gap-3',
            isOverdue ? 'border-accent-red/30' : 'border-subtle'
          )}>
            <span className={clsx('w-2 h-2 rounded-full flex-shrink-0 mt-1.5', urgencyDot)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-text-primary">{lead.name}</span>
                {lead.company && <span className="text-[11px] text-text-tertiary">— {lead.company}</span>}
                <span className={clsx('text-[10px] font-mono', SOURCE_COLOR[lead.source] || 'text-text-tertiary')}>
                  {SOURCE_LABEL[lead.source] || lead.source}
                </span>
                {lead.owner && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary capitalize">{lead.owner}</span>
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
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-tertiary">{t}</span>
                  ))}
                </div>
              )}
            </div>
            {lead.estimated_value_cents ? (
              <span className="text-sm font-mono font-bold text-brand-blue flex-shrink-0">
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
  if (loading) return <div className="space-y-2">{Array.from({length: 4}).map((_,i) => (
    <div key={i} className="rounded-xl border border-subtle bg-bg-surface px-4 py-3">
      <Skeleton className="h-3.5 w-1/3 mb-2" /><Skeleton className="h-3 w-2/3" />
    </div>
  ))}</div>
  if (leads.length === 0) return (
    <div className="py-16 text-center rounded-2xl border border-subtle bg-bg-surface">
      <ListChecks className="w-8 h-8 text-brand-green mx-auto mb-3 opacity-50" />
      <p className="text-sm text-text-secondary font-medium">Follow-up queue is clear</p>
      <p className="text-[12px] text-text-tertiary mt-1">No leads due today or tomorrow</p>
    </div>
  )

  const overdue = leads.filter(l => l.next_action_due && isPast(parseISO(l.next_action_due)))
  const today = leads.filter(l => l.next_action_due && !isPast(parseISO(l.next_action_due)) && isToday(parseISO(l.next_action_due)))
  const tomorrow = leads.filter(l => l.next_action_due && isTomorrow(parseISO(l.next_action_due)))

  function LeadRow({ lead, isOverdue }: { lead: HotLead; isOverdue: boolean }) {
    return (
      <div className={clsx(
        'rounded-xl border bg-bg-surface px-4 py-3',
        isOverdue ? 'border-accent-red/30 bg-accent-red/[0.02]' : 'border-subtle'
      )}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-text-primary">{lead.name}</span>
              {lead.company && <span className="text-[11px] text-text-tertiary">— {lead.company}</span>}
              {lead.owner && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary capitalize">{lead.owner}</span>
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
                  : `Due ${format(parseISO(lead.next_action_due), 'h:mm a')}`}
              </p>
            )}
          </div>
          {lead.estimated_value_cents ? (
            <span className="text-sm font-mono font-bold text-brand-blue flex-shrink-0">
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
          <p className="text-[11px] font-semibold text-accent-red uppercase tracking-wider px-1 mb-2">Overdue ({overdue.length})</p>
          <div className="space-y-2">{overdue.map(l => <LeadRow key={l.id} lead={l} isOverdue />)}</div>
        </div>
      )}
      {today.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-accent-amber uppercase tracking-wider px-1 mb-2">Today ({today.length})</p>
          <div className="space-y-2">{today.map(l => <LeadRow key={l.id} lead={l} isOverdue={false} />)}</div>
        </div>
      )}
      {tomorrow.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider px-1 mb-2">Tomorrow ({tomorrow.length})</p>
          <div className="space-y-2">{tomorrow.map(l => <LeadRow key={l.id} lead={l} isOverdue={false} />)}</div>
        </div>
      )}
    </div>
  )
}
