'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { MonoValue } from '@/components/ui/MonoValue'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Users, Building2, Plus, ArrowRight, Phone, Mail,
  TrendingUp, UserPlus, Send, CheckCircle, XCircle,
  AlertTriangle, Clock, Globe, Zap, MessageSquare,
} from 'lucide-react'
import { format, isPast, parseISO } from 'date-fns'
import type { Client, Lead } from '@/types'
import { clsx } from 'clsx'

const statusBadge: Record<string, { variant: any; label: string; icon: any }> = {
  new:              { variant: 'blue',   label: 'New',           icon: UserPlus },
  contacted:        { variant: 'amber',  label: 'Contacted',     icon: Phone },
  bid_sent:         { variant: 'purple', label: 'Bid Sent',      icon: Send },
  won:              { variant: 'green',  label: 'Won',           icon: CheckCircle },
  lost:             { variant: 'gray',   label: 'Lost',          icon: XCircle },
  qualified:        { variant: 'blue',   label: 'Qualified',     icon: UserPlus },
  estimate_needed:  { variant: 'amber',  label: 'Est. Needed',   icon: Send },
  estimate_sent:    { variant: 'purple', label: 'Est. Sent',     icon: Send },
  follow_up:        { variant: 'amber',  label: 'Follow Up',     icon: Clock },
  nurture:          { variant: 'gray',   label: 'Nurture',       icon: Phone },
}

const SOURCE_ICON: Record<string, { label: string; color: string }> = {
  website:   { label: 'Web',       color: 'text-accent-blue' },
  ghl:       { label: 'GHL',       color: 'text-accent-blue' },
  quo:       { label: 'Quo',       color: 'text-accent-amber' },
  instantly: { label: 'Instantly', color: 'text-brand-green' },
  gmail:     { label: 'Gmail',     color: 'text-accent-red' },
  jobber:    { label: 'Jobber',    color: 'text-text-tertiary' },
  referral:  { label: 'Referral',  color: 'text-accent-blue' },
  manual:    { label: 'Manual',    color: 'text-text-tertiary' },
}

const URGENCY_COLOR: Record<string, string> = {
  high:   'text-accent-red',
  medium: 'text-accent-amber',
  low:    'text-text-tertiary',
}

type Tab = 'clients' | 'leads'

export default function ClientsPage() {
  const [tab, setTab] = useState<Tab>('clients')
  const [clients, setClients] = useState<Client[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewLeadForm, setShowNewLeadForm] = useState(false)
  const [newLead, setNewLead] = useState({ name: '', email: '', phone: '', company: '', service_type: '', message: '' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [cRes, lRes] = await Promise.all([
        supabase.from('clients').select('*').order('company_name', { ascending: true }),
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
      ])
      setClients((cRes.data || []) as Client[])
      setLeads((lRes.data || []) as Lead[])
      setLoading(false)
    }
    load()
  }, [])

  async function submitLead(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    await supabase.from('leads').insert({ ...newLead, status: 'new', source: 'manual' })
    const { data } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
    setLeads((data || []) as Lead[])
    setNewLead({ name: '', email: '', phone: '', company: '', service_type: '', message: '' })
    setShowNewLeadForm(false)
    setSubmitting(false)
    setTab('leads')
  }

  async function updateLeadStatus(id: string, status: string) {
    await supabase.from('leads').update({ status }).eq('id', id)
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status: status as any } : l))
  }

  const STATUSES = ['new', 'contacted', 'bid_sent', 'won', 'lost']
  const leadsByStatus = STATUSES.reduce((acc, s) => {
    acc[s] = leads.filter(l => l.status === s)
    return acc
  }, {} as Record<string, Lead[]>)

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-bg-surface rounded-xl border border-white/[0.06] w-fit">
        {(['clients', 'leads'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all min-h-[44px] ${
              tab === t
                ? 'bg-white/10 text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t === 'clients'
              ? <><Building2 className="w-3.5 h-3.5 inline mr-1.5" />Clients</>
              : <><TrendingUp className="w-3.5 h-3.5 inline mr-1.5" />Leads</>
            }
          </button>
        ))}
      </div>

      {tab === 'clients' ? (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4">
              <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Total Clients</p>
              <p className="text-2xl font-bold font-mono">{clients.length}</p>
            </div>
            <div className="card p-4">
              <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">GC Partners</p>
              <p className="text-2xl font-bold font-mono">{clients.filter(c => c.is_gc).length}</p>
            </div>
            <div className="card p-4">
              <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Residential</p>
              <p className="text-2xl font-bold font-mono">{clients.filter(c => !c.is_gc).length}</p>
            </div>
          </div>

          <Card>
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <h2 className="text-sm font-semibold">All Clients</h2>
              <Button size="sm" icon={<Plus className="w-3 h-3" />}>Add Client</Button>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-white/[0.04]">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="p-4"><Skeleton lines={2} /></div>
                ))
              ) : clients.map(client => (
                <Link key={client.id} href={`/clients/${client.id}`} className="block p-4 hover:bg-white/[0.02] transition-colors active:bg-white/[0.04]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-text-primary truncate">{client.company_name || client.name}</p>
                      {client.company_name && <p className="text-[11px] text-text-tertiary">{client.name}</p>}
                      <div className="flex items-center gap-3 mt-1.5">
                        {client.email && (
                          <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
                            <Mail className="w-2.5 h-2.5" />{client.email}
                          </span>
                        )}
                        {client.phone && (
                          <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
                            <Phone className="w-2.5 h-2.5" />{client.phone}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <Badge variant={client.is_gc ? 'amber' : 'gray'} dot>
                        {client.is_gc ? 'GC' : 'Residential'}
                      </Badge>
                      <span className="text-[10px] text-text-tertiary font-mono">
                        {format(new Date(client.created_at), 'MMM yyyy')}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name / Company</th>
                    <th>Type</th>
                    <th>Contact</th>
                    <th>Since</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}><td colSpan={5}><Skeleton className="h-8" /></td></tr>
                    ))
                  ) : clients.map(client => (
                    <tr key={client.id}>
                      <td>
                        <Link href={`/clients/${client.id}`} className="block hover:text-brand-green transition-colors">
                          <p className="font-medium">{client.company_name || client.name}</p>
                          {client.company_name && <p className="text-[11px] text-text-tertiary">{client.name}</p>}
                        </Link>
                      </td>
                      <td>
                        <Badge variant={client.is_gc ? 'amber' : 'gray'} dot>
                          {client.is_gc ? 'GC' : 'Residential'}
                        </Badge>
                      </td>
                      <td>
                        <div className="space-y-0.5">
                          {client.email && (
                            <div className="flex items-center gap-1 text-[11px] text-text-tertiary">
                              <Mail className="w-2.5 h-2.5" />
                              {client.email}
                            </div>
                          )}
                          {client.phone && (
                            <div className="flex items-center gap-1 text-[11px] text-text-tertiary">
                              <Phone className="w-2.5 h-2.5" />
                              {client.phone}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="text-[11px] text-text-tertiary font-mono">
                          {format(new Date(client.created_at), 'MMM yyyy')}
                        </span>
                      </td>
                      <td>
                        <Link href={`/clients/${client.id}`}>
                          <ArrowRight className="w-3.5 h-3.5 text-text-tertiary hover:text-text-primary" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        /* LEADS — Kanban board */
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm text-text-secondary">
                <span className="font-mono font-semibold text-text-primary">{leads.filter(l => l.status !== 'lost').length}</span> active leads
              </p>
              <p className="text-sm text-text-secondary">
                Pipeline:{' '}
                <span className="font-mono font-semibold text-text-primary">
                  ${Math.round(leads.filter(l => !['lost'].includes(l.status)).reduce((s, l) => s + (l.estimated_value_cents || 0), 0) / 100).toLocaleString()}
                </span>
              </p>
            </div>
            <Button size="sm" icon={<Plus className="w-3 h-3" />} onClick={() => setShowNewLeadForm(true)}>
              New Lead
            </Button>
          </div>

          {/* New Lead Form */}
          {showNewLeadForm && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-4">New Lead</h3>
              <form onSubmit={submitLead} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] text-text-tertiary mb-1">Name *</label>
                  <input required value={newLead.name} onChange={e => setNewLead(p => ({...p, name: e.target.value}))} className="w-full px-3 py-2 text-sm" placeholder="Contact name" />
                </div>
                <div>
                  <label className="block text-[11px] text-text-tertiary mb-1">Company</label>
                  <input value={newLead.company} onChange={e => setNewLead(p => ({...p, company: e.target.value}))} className="w-full px-3 py-2 text-sm" placeholder="Company / GC name" />
                </div>
                <div>
                  <label className="block text-[11px] text-text-tertiary mb-1">Email</label>
                  <input type="email" value={newLead.email} onChange={e => setNewLead(p => ({...p, email: e.target.value}))} className="w-full px-3 py-2 text-sm" placeholder="email@example.com" />
                </div>
                <div>
                  <label className="block text-[11px] text-text-tertiary mb-1">Phone</label>
                  <input value={newLead.phone} onChange={e => setNewLead(p => ({...p, phone: e.target.value}))} className="w-full px-3 py-2 text-sm" placeholder="(602) 555-0000" />
                </div>
                <div>
                  <label className="block text-[11px] text-text-tertiary mb-1">Service Type</label>
                  <input value={newLead.service_type} onChange={e => setNewLead(p => ({...p, service_type: e.target.value}))} className="w-full px-3 py-2 text-sm" placeholder="Post-Construction Clean" />
                </div>
                <div>
                  <label className="block text-[11px] text-text-tertiary mb-1">Notes</label>
                  <input value={newLead.message} onChange={e => setNewLead(p => ({...p, message: e.target.value}))} className="w-full px-3 py-2 text-sm" placeholder="Details..." />
                </div>
                <div className="col-span-1 sm:col-span-2 flex items-center gap-2 justify-end">
                  <Button variant="ghost" size="sm" type="button" onClick={() => setShowNewLeadForm(false)}>Cancel</Button>
                  <Button size="sm" loading={submitting} type="submit">Save Lead</Button>
                </div>
              </form>
            </Card>
          )}

          {/* Kanban — vertical stack on mobile, horizontal on desktop */}
          <div className="flex flex-col sm:grid sm:grid-cols-3 md:grid-cols-5 gap-3">
            {STATUSES.map(status => {
              const meta = statusBadge[status]
              const statusLeads = leadsByStatus[status] || []
              return (
                <div key={status}>
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <span className="text-[11px] text-text-tertiary font-mono">({statusLeads.length})</span>
                  </div>
                  <div className="space-y-2">
                    {loading ? (
                      Array.from({length: 2}).map((_,i) => (
                        <div key={i} className="kanban-card"><Skeleton lines={3} /></div>
                      ))
                    ) : statusLeads.length === 0 ? (
                      <div className="kanban-card text-[11px] text-text-tertiary text-center py-3">Empty</div>
                    ) : statusLeads.map(lead => {
                      const src = SOURCE_ICON[(lead as any).source] || SOURCE_ICON.manual
                      const urgency = (lead as any).urgency as string | undefined
                      const nextAction = (lead as any).next_action as string | undefined
                      const nextDue = (lead as any).next_action_due as string | undefined
                      const owner = (lead as any).owner as string | undefined
                      const isOverdue = nextDue ? isPast(parseISO(nextDue)) : false
                      return (
                        <div key={lead.id} className={clsx('kanban-card', isOverdue && 'border-accent-red/40')}>
                          <div className="flex items-start justify-between gap-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {urgency === 'high' && <span className="w-1.5 h-1.5 rounded-full bg-accent-red flex-shrink-0 mt-1" />}
                              {urgency === 'medium' && <span className="w-1.5 h-1.5 rounded-full bg-accent-amber flex-shrink-0 mt-1" />}
                              <p className="text-sm font-medium text-text-primary truncate">{lead.name}</p>
                            </div>
                            <span className={clsx('text-[10px] font-mono flex-shrink-0', src.color)}>{src.label}</span>
                          </div>
                          {lead.company && <p className="text-[11px] text-text-tertiary mt-0.5 truncate">{lead.company}</p>}
                          {lead.service_type && <p className="text-[11px] text-text-tertiary truncate">{lead.service_type}</p>}
                          {lead.estimated_value_cents ? (
                            <p className="text-xs font-mono text-brand-green mt-1.5">
                              ${(lead.estimated_value_cents / 100).toLocaleString()}
                            </p>
                          ) : null}
                          {nextAction && (
                            <div className={clsx('flex items-start gap-1 mt-1.5', isOverdue ? 'text-accent-red' : 'text-text-tertiary')}>
                              <Clock className="w-3 h-3 flex-shrink-0 mt-0.5" />
                              <p className="text-[10px] leading-tight line-clamp-2">{nextAction}</p>
                            </div>
                          )}
                          <div className="flex items-center justify-between mt-1.5">
                            <p className="text-[10px] text-text-tertiary">
                              {format(new Date(lead.created_at), 'MMM d')}
                            </p>
                            {owner && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-text-secondary capitalize">{owner}</span>
                            )}
                          </div>
                          {status !== 'won' && status !== 'lost' && (
                            <div className="flex gap-1 mt-2">
                              <button
                                onClick={() => {
                                  const next = { new: 'contacted', contacted: 'bid_sent', bid_sent: 'won' }[status]
                                  if (next) updateLeadStatus(lead.id, next)
                                }}
                                className="text-[10px] text-brand-green hover:text-white bg-brand-green/10 hover:bg-brand-green/30 px-2 py-0.5 rounded transition-colors min-h-[32px] flex items-center"
                              >
                                → {statusBadge[{ new: 'contacted', contacted: 'bid_sent', bid_sent: 'won' }[status] || 'won']?.label}
                              </button>
                              <button
                                onClick={() => updateLeadStatus(lead.id, 'lost')}
                                className="text-[10px] text-text-tertiary hover:text-accent-red px-1 py-0.5 rounded transition-colors min-h-[32px] flex items-center"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
