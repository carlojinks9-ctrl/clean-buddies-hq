'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { MonoValue } from '@/components/ui/MonoValue'
import { Skeleton } from '@/components/ui/Skeleton'
import { ShoppingCart, Plus, ExternalLink, Check, Package, Clock, Pencil, Trash2, X, Save } from 'lucide-react'
import { format } from 'date-fns'
import type { SupplyRequest } from '@/types'
import { clsx } from 'clsx'

const statusMeta: Record<string, { variant: 'amber' | 'blue' | 'green'; label: string; icon: React.ElementType }> = {
  pending:  { variant: 'amber', label: 'Pending',  icon: Clock },
  ordered:  { variant: 'blue',  label: 'Ordered',  icon: Package },
  received: { variant: 'green', label: 'Received', icon: Check },
}
const priorityMeta: Record<string, string> = {
  low:    'text-text-tertiary',
  medium: 'text-accent-blue',
  high:   'text-accent-red',
}

interface EditState {
  item_name: string
  quantity: string
  job_name: string
  priority: string
  estimated_cost_cents: string
}

export default function SuppliesPage() {
  const [items, setItems] = useState<SupplyRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ item_name: '', quantity: '1', unit: '', job_name: '', requested_by: '', priority: 'medium', estimated_cost_cents: '' })
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState>({ item_name: '', quantity: '1', job_name: '', priority: 'medium', estimated_cost_cents: '' })
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('supply_requests').select('*').order('created_at', { ascending: false })
    setItems((data || []) as SupplyRequest[])
    setLoading(false)
  }

  async function updateStatus(id: string, status: string) {
    const update: Record<string, unknown> = { status }
    if (status === 'ordered') update.ordered_at = new Date().toISOString()
    if (status === 'received') update.received_at = new Date().toISOString()
    await supabase.from('supply_requests').update(update).eq('id', id)
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...update } as SupplyRequest : i))
  }

  function startEdit(item: SupplyRequest) {
    setEditingId(item.id)
    setEditState({
      item_name: item.item_name,
      quantity: String(item.quantity),
      job_name: item.job_name || '',
      priority: item.priority,
      estimated_cost_cents: item.estimated_cost_cents ? String(item.estimated_cost_cents / 100) : '',
    })
  }

  async function saveEdit(id: string) {
    const update = {
      item_name: editState.item_name.trim(),
      quantity: parseInt(editState.quantity) || 1,
      job_name: editState.job_name.trim() || null,
      priority: editState.priority,
      estimated_cost_cents: editState.estimated_cost_cents ? Math.round(parseFloat(editState.estimated_cost_cents) * 100) : null,
    }
    await supabase.from('supply_requests').update(update).eq('id', id)
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...update } as SupplyRequest : i))
    setEditingId(null)
  }

  async function deleteItem(id: string) {
    await supabase.from('supply_requests').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
    setDeletingId(null)
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    await supabase.from('supply_requests').insert({
      ...form,
      quantity: parseInt(form.quantity),
      estimated_cost_cents: form.estimated_cost_cents ? Math.round(parseFloat(form.estimated_cost_cents) * 100) : null,
      status: 'pending',
    })
    await load()
    setForm({ item_name: '', quantity: '1', unit: '', job_name: '', requested_by: '', priority: 'medium', estimated_cost_cents: '' })
    setShowForm(false)
    setSubmitting(false)
  }

  const filtered = statusFilter === 'all' ? items : items.filter(i => i.status === statusFilter)
  const pendingTotal = items.filter(i => i.status === 'pending').reduce((s, i) => s + (i.estimated_cost_cents || 0), 0)
  const pendingCount = items.filter(i => i.status === 'pending').length

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Pending Orders</p>
          <p className="text-2xl font-bold font-mono">{pendingCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Est. Cost Pending</p>
          <MonoValue cents={pendingTotal} size="xl" color="text-accent-amber" />
        </div>
        <div className="card p-4">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Total Requests</p>
          <p className="text-2xl font-bold font-mono">{items.length}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {['all', 'pending', 'ordered', 'received'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all',
                statusFilter === s ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <Button size="sm" icon={<Plus className="w-3 h-3" />} onClick={() => setShowForm(true)}>
          Add Item
        </Button>
      </div>

      {/* Add Form */}
      {showForm && (
        <Card className="p-4">
          <form onSubmit={addItem} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div className="col-span-1 sm:col-span-2 md:col-span-2">
              <label className="block text-[11px] text-text-tertiary mb-1">Item *</label>
              <input required value={form.item_name} onChange={e => setForm(p => ({...p, item_name: e.target.value}))} className="w-full px-3 py-2 text-sm" placeholder="Item description" />
            </div>
            <div>
              <label className="block text-[11px] text-text-tertiary mb-1">Qty</label>
              <input type="number" min="1" value={form.quantity} onChange={e => setForm(p => ({...p, quantity: e.target.value}))} className="w-full px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-text-tertiary mb-1">Job</label>
              <input value={form.job_name} onChange={e => setForm(p => ({...p, job_name: e.target.value}))} className="w-full px-3 py-2 text-sm" placeholder="Job name" />
            </div>
            <div>
              <label className="block text-[11px] text-text-tertiary mb-1">Requested By</label>
              <input value={form.requested_by} onChange={e => setForm(p => ({...p, requested_by: e.target.value}))} className="w-full px-3 py-2 text-sm" placeholder="Name" />
            </div>
            <div>
              <label className="block text-[11px] text-text-tertiary mb-1">Est. Cost ($)</label>
              <input type="number" step="0.01" value={form.estimated_cost_cents} onChange={e => setForm(p => ({...p, estimated_cost_cents: e.target.value}))} className="w-full px-3 py-2 text-sm font-mono" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-[11px] text-text-tertiary mb-1">Priority</label>
              <select value={form.priority} onChange={e => setForm(p => ({...p, priority: e.target.value}))} className="w-full px-3 py-2 text-sm">
                {['low','medium','high'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="col-span-1 sm:col-span-2 md:col-span-3 flex gap-2 justify-end">
              <Button variant="ghost" size="sm" type="button" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" loading={submitting} type="submit">Save</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Table */}
      <Card>
        <div className="px-4 py-3 border-b border-subtle flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-text-tertiary" />
          <h2 className="text-sm font-semibold">Supply Requests</h2>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-subtle">
          {loading ? (
            Array.from({length: 4}).map((_,i) => <div key={i} className="p-4"><Skeleton lines={2} /></div>)
          ) : filtered.map(item => {
            const meta = statusMeta[item.status]
            const isEditing = editingId === item.id
            const isDeleting = deletingId === item.id
            return (
              <div key={item.id} className="p-4">
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      value={editState.item_name}
                      onChange={e => setEditState(p => ({...p, item_name: e.target.value}))}
                      className="w-full px-2 py-1 text-sm"
                    />
                    <div className="flex gap-2">
                      <input
                        type="number" min="1"
                        value={editState.quantity}
                        onChange={e => setEditState(p => ({...p, quantity: e.target.value}))}
                        className="w-16 px-2 py-1 text-sm"
                        placeholder="Qty"
                      />
                      <input
                        value={editState.job_name}
                        onChange={e => setEditState(p => ({...p, job_name: e.target.value}))}
                        className="flex-1 px-2 py-1 text-sm"
                        placeholder="Job name"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary px-2 py-1">
                        <X className="w-3 h-3" /> Cancel
                      </button>
                      <button onClick={() => saveEdit(item.id)} className="flex items-center gap-1 text-[11px] text-brand-blue hover:text-brand-blue-dim px-2 py-1 bg-brand-blue/10 rounded">
                        <Save className="w-3 h-3" /> Save
                      </button>
                    </div>
                  </div>
                ) : isDeleting ? (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-text-secondary flex-1">Delete &ldquo;{item.item_name}&rdquo;?</span>
                    <button onClick={() => setDeletingId(null)} className="text-[11px] text-text-tertiary hover:text-text-secondary px-2 py-1">Cancel</button>
                    <button onClick={() => deleteItem(item.id)} className="text-[11px] text-accent-red hover:text-accent-red/80 px-2 py-1 bg-accent-red/10 rounded">Delete</button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <p className="font-medium text-text-primary">{item.item_name}</p>
                        <p className="text-[11px] text-text-tertiary">x{item.quantity}{item.unit ? ` ${item.unit}` : ''}{item.job_name ? ` · ${item.job_name}` : ''}</p>
                      </div>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {item.requested_by && <span className="text-[11px] text-text-secondary">{item.requested_by}</span>}
                      <span className={`text-[11px] font-medium capitalize ${priorityMeta[item.priority]}`}>{item.priority}</span>
                      {item.estimated_cost_cents && <MonoValue cents={item.estimated_cost_cents} size="sm" showCents />}
                      <div className="ml-auto flex items-center gap-1.5">
                        {item.status === 'pending' && (
                          <button onClick={() => updateStatus(item.id, 'ordered')} className="text-[10px] px-2 py-1 rounded bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors min-h-[32px]">Ordered</button>
                        )}
                        {item.status === 'ordered' && (
                          <button onClick={() => updateStatus(item.id, 'received')} className="text-[10px] px-2 py-1 rounded bg-brand-green/10 text-brand-green hover:bg-brand-green/20 transition-colors min-h-[32px]">Received</button>
                        )}
                        <button onClick={() => startEdit(item)} className="p-1.5 rounded hover:bg-bg-elevated text-text-tertiary hover:text-text-secondary transition-colors min-h-[32px]">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button onClick={() => setDeletingId(item.id)} className="p-1.5 rounded hover:bg-accent-red/10 text-text-tertiary hover:text-accent-red transition-colors min-h-[32px]">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })}
          {!loading && filtered.length === 0 && (
            <div className="p-8 text-center text-text-tertiary text-sm">No supply requests</div>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Job</th>
                <th>Requested By</th>
                <th>Priority</th>
                <th className="text-right">Est. Cost</th>
                <th>Status</th>
                <th>Date</th>
                <th>Links</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({length: 5}).map((_,i) => (
                  <tr key={i}><td colSpan={9}><Skeleton className="h-8" /></td></tr>
                ))
              ) : filtered.map(item => {
                const meta = statusMeta[item.status]
                const isEditing = editingId === item.id
                const isDeleting = deletingId === item.id

                if (isEditing) {
                  return (
                    <tr key={item.id} className="bg-bg-elevated/50">
                      <td colSpan={4}>
                        <div className="flex items-center gap-2">
                          <input
                            value={editState.item_name}
                            onChange={e => setEditState(p => ({...p, item_name: e.target.value}))}
                            className="flex-1 px-2 py-1 text-sm"
                            autoFocus
                          />
                          <input
                            type="number" min="1"
                            value={editState.quantity}
                            onChange={e => setEditState(p => ({...p, quantity: e.target.value}))}
                            className="w-16 px-2 py-1 text-sm"
                          />
                          <input
                            value={editState.job_name}
                            onChange={e => setEditState(p => ({...p, job_name: e.target.value}))}
                            className="w-32 px-2 py-1 text-sm"
                            placeholder="Job"
                          />
                          <select
                            value={editState.priority}
                            onChange={e => setEditState(p => ({...p, priority: e.target.value}))}
                            className="px-2 py-1 text-sm"
                          >
                            {['low','medium','high'].map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </td>
                      <td className="text-right">
                        <input
                          type="number" step="0.01"
                          value={editState.estimated_cost_cents}
                          onChange={e => setEditState(p => ({...p, estimated_cost_cents: e.target.value}))}
                          className="w-24 px-2 py-1 text-sm font-mono text-right"
                          placeholder="0.00"
                        />
                      </td>
                      <td colSpan={3} />
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditingId(null)} className="p-1 rounded hover:bg-bg-elevated text-text-tertiary hover:text-text-secondary transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => saveEdit(item.id)} className="flex items-center gap-1 px-2 py-0.5 rounded bg-brand-blue/10 text-brand-blue hover:bg-brand-blue/20 text-[10px] transition-colors">
                            <Save className="w-3 h-3" /> Save
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                }

                if (isDeleting) {
                  return (
                    <tr key={item.id} className="bg-accent-red/5">
                      <td colSpan={8}>
                        <span className="text-sm text-accent-red">Delete &ldquo;{item.item_name}&rdquo;? This cannot be undone.</span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setDeletingId(null)} className="text-[10px] px-2 py-0.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated transition-colors">Cancel</button>
                          <button onClick={() => deleteItem(item.id)} className="text-[10px] px-2 py-0.5 rounded bg-accent-red/10 text-accent-red hover:bg-accent-red/20 transition-colors">Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr key={item.id}>
                    <td>
                      <p className="font-medium">{item.item_name}</p>
                      <p className="text-[11px] text-text-tertiary">x{item.quantity}{item.unit ? ` ${item.unit}` : ''}</p>
                    </td>
                    <td>
                      <span className="text-[11px] text-text-secondary">{item.job_name || '—'}</span>
                    </td>
                    <td>
                      <span className="text-[11px] text-text-secondary">{item.requested_by}</span>
                    </td>
                    <td>
                      <span className={`text-xs font-medium capitalize ${priorityMeta[item.priority]}`}>
                        {item.priority}
                      </span>
                    </td>
                    <td className="text-right">
                      {item.estimated_cost_cents ? (
                        <MonoValue cents={item.estimated_cost_cents} size="sm" showCents />
                      ) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </td>
                    <td>
                      <span className="text-[11px] text-text-tertiary font-mono">
                        {format(new Date(item.created_at), 'MMM d')}
                      </span>
                    </td>
                    <td>
                      {item.home_depot_url ? (
                        <a href={item.home_depot_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[11px] text-accent-blue hover:underline">
                          <ExternalLink className="w-3 h-3" /> HD
                        </a>
                      ) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        {item.status === 'pending' && (
                          <button
                            onClick={() => updateStatus(item.id, 'ordered')}
                            className="text-[10px] px-2 py-0.5 rounded bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors"
                          >
                            Ordered
                          </button>
                        )}
                        {item.status === 'ordered' && (
                          <button
                            onClick={() => updateStatus(item.id, 'received')}
                            className="text-[10px] px-2 py-0.5 rounded bg-brand-green/10 text-brand-green hover:bg-brand-green/20 transition-colors"
                          >
                            Received
                          </button>
                        )}
                        <button
                          onClick={() => startEdit(item)}
                          className="p-1 rounded hover:bg-bg-elevated text-text-tertiary hover:text-text-secondary transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setDeletingId(item.id)}
                          className="p-1 rounded hover:bg-accent-red/10 text-text-tertiary hover:text-accent-red transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center text-text-tertiary py-8">No supply requests</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
