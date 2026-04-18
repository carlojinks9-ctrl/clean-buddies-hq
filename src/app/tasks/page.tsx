'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/components/ui/Toast'
import {
  CheckSquare, Plus, AlertCircle, Clock, CheckCircle2,
  Circle, Trash2, GripVertical, ChevronDown, ChevronUp, ListPlus, X,
} from 'lucide-react'
import { format, isToday, isPast, parseISO } from 'date-fns'
import type { Task } from '@/types'
import { clsx } from 'clsx'

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = ['all', 'sales', 'operations', 'admin', 'hiring', 'finance'] as const

// Smart shortcuts — combine display label + matching categories + optional status filter
const SHORTCUTS = [
  { label: 'Invoicing',    category: 'finance',    emoji: '💰' },
  { label: 'Proposals',    category: 'sales',      emoji: '📋' },
  { label: 'Walkthroughs', category: 'operations', emoji: '🏗' },
] as const

const CATEGORY_BADGE: Record<string, any> = {
  sales: 'green', operations: 'blue', admin: 'gray', hiring: 'purple', finance: 'amber',
}

const PRIORITY_META: Record<string, { color: string; label: string; order: number }> = {
  urgent: { color: 'text-accent-red',    label: 'Urgent', order: 0 },
  high:   { color: 'text-accent-amber',  label: 'High',   order: 1 },
  medium: { color: 'text-accent-blue',   label: 'Med',    order: 2 },
  low:    { color: 'text-text-tertiary', label: 'Low',    order: 3 },
}

const COLUMNS: { key: Task['status']; label: string; icon: any; color: string }[] = [
  { key: 'todo',        label: 'To Do',       icon: Circle,       color: 'text-text-tertiary' },
  { key: 'in_progress', label: 'In Progress', icon: Clock,        color: 'text-accent-amber' },
  { key: 'done',        label: 'Done',        icon: CheckCircle2, color: 'text-brand-green' },
]

// ── Empty form state ─────────────────────────────────────────────────────────

const EMPTY_FORM = {
  title: '', description: '', category: 'operations', priority: 'medium',
  assignee: 'carlo', due_date: '',
}

// ── Bulk parse helpers ────────────────────────────────────────────────────────

type ParsedTask = {
  title: string
  assignee: 'carlo' | 'jorden' | 'both'
  status: 'todo' | 'done'
  category: Task['category']
  priority: Task['priority']
}

function detectCategory(title: string): Task['category'] {
  const t = title.toLowerCase()
  if (/hir(e|ing)|recruit|interview|onboard/.test(t)) return 'hiring'
  if (/tax|finance|qbo|quickbook|invoice|payroll|account|p&l|ar |revenue|billing/.test(t)) return 'finance'
  if (/website|seo|ads|lead|pitch|bid|quote|market|sales|client|proposal|crm/.test(t)) return 'sales'
  if (/admin|email|call|meeting|license|permit|insur|contract|docu/.test(t)) return 'admin'
  return 'operations'
}

function parseBulkText(raw: string): ParsedTask[] {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      // Detect done status from ✅
      const done = line.includes('✅')
      let text = line.replace(/✅/g, '').trim()

      // Detect assignee from (Carlo), (Jorden), (Both) — case insensitive
      let assignee: ParsedTask['assignee'] = 'carlo'
      text = text.replace(/\((carlo|jorden|both)\)/gi, (_, a) => {
        assignee = a.toLowerCase() as ParsedTask['assignee']
        return ''
      }).trim()

      return {
        title: text,
        assignee,
        status: (done ? 'done' : 'todo') as ParsedTask['status'],
        category: detectCategory(text),
        priority: 'medium' as ParsedTask['priority'],
      }
    })
    .filter(t => t.title.length > 0)
}

// ── Main component ───────────────────────────────────────────────────────────

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [catFilter, setCatFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [showDone, setShowDone] = useState(false)
  // Bulk add state
  const [showBulk, setShowBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkParsed, setBulkParsed] = useState<ParsedTask[]>([])
  const [bulkSaving, setBulkSaving] = useState(false)
  // Drag state
  const dragId = useRef<string | null>(null)
  const dragOverCol = useRef<Task['status'] | null>(null)
  const [dragOverColState, setDragOverColState] = useState<Task['status'] | null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Tasks load error:', error)
      toast(`Failed to load tasks: ${error.message}`, 'error')
    } else {
      setTasks((data || []) as Task[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── Create ────────────────────────────────────────────────────────────────

  async function addTask(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSubmitting(true)

    const optimisticId = `temp-${Date.now()}`
    const optimistic: Task = {
      id: optimisticId,
      title: form.title.trim(),
      description: form.description || null,
      category: form.category as Task['category'],
      priority: form.priority as Task['priority'],
      status: 'todo',
      assignee: form.assignee as Task['assignee'],
      due_date: form.due_date || null,
      job_id: null,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    // Optimistic update
    setTasks(prev => [optimistic, ...prev])
    setForm(EMPTY_FORM)
    setShowForm(false)

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title: optimistic.title,
        description: optimistic.description,
        category: optimistic.category,
        priority: optimistic.priority,
        status: 'todo',
        assignee: optimistic.assignee,
        due_date: optimistic.due_date || null,
      })
      .select()
      .single()

    if (error) {
      // Roll back optimistic update
      setTasks(prev => prev.filter(t => t.id !== optimisticId))
      toast(`Save failed: ${error.message}`, 'error')
      console.error('Task insert error:', error)
      // Re-open form with data so they don't lose it
      setForm({
        title: optimistic.title,
        description: optimistic.description || '',
        category: optimistic.category,
        priority: optimistic.priority,
        assignee: optimistic.assignee || 'carlo',
        due_date: optimistic.due_date || '',
      })
      setShowForm(true)
    } else {
      // Replace temp id with real id
      setTasks(prev => prev.map(t => t.id === optimisticId ? (data as Task) : t))
      toast('Task saved')
    }

    setSubmitting(false)
  }

  // ── Update status ─────────────────────────────────────────────────────────

  async function updateStatus(id: string, status: Task['status']) {
    const prev = tasks.find(t => t.id === id)
    if (!prev || prev.status === status) return

    // Optimistic
    setTasks(ts => ts.map(t => t.id === id ? { ...t, status } : t))

    // Auto-expand done section so task doesn't "disappear"
    if (status === 'done') setShowDone(true)

    const { error } = await supabase.from('tasks').update({ status }).eq('id', id)
    if (error) {
      setTasks(ts => ts.map(t => t.id === id ? { ...t, status: prev.status } : t))
      toast(`Update failed: ${error.message}`, 'error')
    } else {
      if (status === 'done') toast('Task done — visible in completed section below ↓')
      if (status === 'todo' || status === 'in_progress') toast('Task reopened')
    }
  }

  // ── Cycle status on click ─────────────────────────────────────────────────

  function cycleStatus(task: Task) {
    const next: Record<Task['status'], Task['status']> = {
      todo: 'in_progress',
      in_progress: 'done',
      done: 'todo',  // clicking again on done = reopen
    }
    updateStatus(task.id, next[task.status])
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function deleteTask(id: string) {
    const prev = tasks.find(t => t.id === id)
    setTasks(ts => ts.filter(t => t.id !== id))

    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) {
      if (prev) setTasks(ts => [...ts, prev])
      toast(`Delete failed: ${error.message}`, 'error')
    } else {
      toast('Task deleted')
    }
  }

  // ── Bulk save ─────────────────────────────────────────────────────────────

  async function saveBulkTasks() {
    if (bulkParsed.length === 0) return
    setBulkSaving(true)

    const rows = bulkParsed.map(t => ({
      title: t.title,
      category: t.category,
      priority: t.priority,
      status: t.status,
      assignee: t.assignee,
      description: null,
      due_date: null,
    }))

    const { data, error } = await supabase.from('tasks').insert(rows).select()

    if (error) {
      toast(`Bulk save failed: ${error.message}`, 'error')
    } else {
      setTasks(prev => [...(data as Task[]), ...prev])
      toast(`${rows.length} task${rows.length !== 1 ? 's' : ''} added`)
      setShowBulk(false)
      setBulkText('')
      setBulkParsed([])
    }
    setBulkSaving(false)
  }

  // ── Drag and drop ─────────────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, id: string) {
    dragId.current = id
    e.dataTransfer.effectAllowed = 'move'
    // Slight delay so the drag image renders before opacity change
    setTimeout(() => {
      (e.target as HTMLElement).style.opacity = '0.4'
    }, 0)
  }

  function onDragEnd(e: React.DragEvent) {
    ;(e.target as HTMLElement).style.opacity = '1'
    dragId.current = null
    dragOverCol.current = null
    setDragOverColState(null)
  }

  function onDragOver(e: React.DragEvent, col: Task['status']) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverCol.current !== col) {
      dragOverCol.current = col
      setDragOverColState(col)
    }
  }

  function onDrop(e: React.DragEvent, col: Task['status']) {
    e.preventDefault()
    setDragOverColState(null)
    if (dragId.current && dragId.current !== col) {
      updateStatus(dragId.current, col)
    }
  }

  // ── Filtered lists ────────────────────────────────────────────────────────

  const filtered = tasks
    .filter(t => catFilter === 'all' || t.category === catFilter)
    .filter(t => assigneeFilter === 'all' || t.assignee === assigneeFilter || t.assignee === 'both')

  const urgentActive = filtered.filter(t => t.priority === 'urgent' && t.status !== 'done')

  const byColumn = (col: Task['status']) =>
    filtered
      .filter(t => t.status === col && !(col !== 'done' && t.priority === 'urgent'))
      .sort((a, b) => PRIORITY_META[a.priority].order - PRIORITY_META[b.priority].order)

  const doneTasks = filtered.filter(t => t.status === 'done')
  const openCount = filtered.filter(t => t.status !== 'done').length

  // ── Task card ─────────────────────────────────────────────────────────────

  function TaskCard({ task }: { task: Task }) {
    const isDue = task.due_date && isToday(parseISO(task.due_date))
    const isOverdue = task.due_date && isPast(parseISO(task.due_date)) && !isDue && task.status !== 'done'
    const StatusIcon = task.status === 'in_progress' ? Clock
      : task.status === 'done' ? CheckCircle2 : Circle

    return (
      <div
        draggable
        onDragStart={e => onDragStart(e, task.id)}
        onDragEnd={onDragEnd}
        className={clsx(
          'group relative rounded-xl border p-3 cursor-grab active:cursor-grabbing',
          'transition-all duration-150 hover:shadow-lg hover:-translate-y-0.5',
          task.priority === 'urgent'
            ? 'bg-accent-red/5 border-accent-red/20 hover:border-accent-red/30'
            : 'bg-bg-elevated border-white/[0.06] hover:border-white/10'
        )}
      >
        {/* Drag handle */}
        <div className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-30 transition-opacity">
          <GripVertical className="w-3 h-3 text-text-tertiary" />
        </div>

        <div className="flex items-start gap-2 pl-2">
          {/* Status toggle */}
          <button
            onClick={() => cycleStatus(task)}
            className="mt-0.5 flex-shrink-0 hover:scale-110 transition-transform"
            title={task.status === 'done' ? 'Reopen task' : task.status === 'in_progress' ? 'Mark done' : 'Start task'}
          >
            <StatusIcon className={clsx('w-4 h-4', {
              'text-text-tertiary hover:text-accent-amber': task.status === 'todo',
              'text-accent-amber': task.status === 'in_progress',
              'text-brand-green': task.status === 'done',
            })} />
          </button>

          <div className="flex-1 min-w-0">
            <p className={clsx(
              'text-sm font-medium leading-snug',
              task.status === 'done' ? 'line-through text-text-tertiary' : 'text-text-primary',
            )}>
              {task.title}
            </p>

            {task.description && (
              <p className="text-[11px] text-text-tertiary mt-0.5 truncate">{task.description}</p>
            )}

            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <Badge variant={CATEGORY_BADGE[task.category]} className="text-[10px]">
                {task.category}
              </Badge>
              <span className={`text-[10px] font-semibold ${PRIORITY_META[task.priority].color}`}>
                {PRIORITY_META[task.priority].label}
              </span>
              {task.due_date && (
                <span className={clsx('text-[10px] font-mono', {
                  'text-accent-red font-semibold': isOverdue,
                  'text-accent-amber font-semibold': isDue,
                  'text-text-tertiary': !isOverdue && !isDue,
                })}>
                  {isOverdue ? '⚠ ' : isDue ? '📅 ' : ''}{format(parseISO(task.due_date), 'MMM d')}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Assignee chip */}
            {task.assignee && (
              <div className={clsx(
                'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold',
                task.assignee === 'carlo'  ? 'bg-brand-green/20 text-brand-green' :
                task.assignee === 'jorden' ? 'bg-accent-blue/20 text-accent-blue' :
                'bg-accent-amber/20 text-accent-amber'
              )} title={task.assignee}>
                {task.assignee === 'both' ? '2' : task.assignee[0].toUpperCase()}
              </div>
            )}

            {/* Delete */}
            <button
              onClick={() => deleteTask(task.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent-red/10 text-text-tertiary hover:text-accent-red"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Column ────────────────────────────────────────────────────────────────

  function KanbanColumn({ col }: { col: typeof COLUMNS[number] }) {
    const colTasks = byColumn(col.key)
    const isDragOver = dragOverColState === col.key
    const Icon = col.icon

    return (
      <div
        className={clsx(
          'flex flex-col rounded-2xl border transition-all duration-150',
          isDragOver
            ? 'border-brand-green/40 bg-brand-green/5 shadow-[0_0_0_2px_rgba(29,158,117,0.15)]'
            : 'border-white/[0.06] bg-bg-surface'
        )}
        onDragOver={e => onDragOver(e, col.key)}
        onDrop={e => onDrop(e, col.key)}
      >
        {/* Column header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <Icon className={clsx('w-4 h-4', col.color)} />
          <span className="text-sm font-semibold text-text-primary">{col.label}</span>
          <span className={clsx(
            'ml-auto text-[11px] font-mono px-1.5 py-0.5 rounded-md',
            col.key === 'done'
              ? 'bg-brand-green/10 text-brand-green'
              : colTasks.length > 0
              ? 'bg-white/5 text-text-secondary'
              : 'bg-white/[0.03] text-text-tertiary'
          )}>
            {colTasks.length}
          </span>
        </div>

        {/* Drop zone */}
        <div className="flex-1 p-3 space-y-2 min-h-[120px]">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: col.key === 'todo' ? 3 : 2 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-white/[0.06] bg-bg-elevated p-3">
                  <Skeleton className="h-3.5 w-4/5 mb-2" />
                  <Skeleton className="h-2.5 w-2/5" />
                </div>
              ))}
            </div>
          ) : colTasks.length === 0 ? (
            <div className={clsx(
              'flex items-center justify-center h-16 rounded-xl border-2 border-dashed text-[11px] transition-colors',
              isDragOver
                ? 'border-brand-green/40 text-brand-green'
                : 'border-white/[0.06] text-text-tertiary'
            )}>
              {isDragOver ? 'Drop here' : 'No tasks'}
            </div>
          ) : (
            colTasks.map(task => <TaskCard key={task.id} task={task} />)
          )}
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCatFilter(cat)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize',
                catFilter === cat
                  ? 'bg-white/10 text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
              )}
            >
              {cat}
            </button>
          ))}
          <div className="w-px h-4 bg-white/10 mx-1" />
          {/* Smart category shortcuts */}
          {SHORTCUTS.map(s => (
            <button
              key={s.label}
              onClick={() => setCatFilter(s.category)}
              className={clsx(
                'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                catFilter === s.category
                  ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/20'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-white/[0.04]'
              )}
            >
              {s.emoji} {s.label}
            </button>
          ))}
          <div className="w-px h-4 bg-white/10 mx-1" />
          {(['all', 'carlo', 'jorden'] as const).map(a => (
            <button
              key={a}
              onClick={() => setAssigneeFilter(a)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize',
                assigneeFilter === a
                  ? 'bg-brand-green/10 text-brand-green border border-brand-green/20'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
              )}
            >
              {a === 'all' ? '👥 All' : a === 'carlo' ? '🟢 Carlo' : '🔵 Jorden'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-text-tertiary font-mono">
            {openCount} open · {doneTasks.length} done
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<ListPlus className="w-3.5 h-3.5" />}
            onClick={() => { setShowBulk(true); setBulkText(''); setBulkParsed([]) }}
          >
            Bulk Add
          </Button>
          <Button
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => { setShowForm(true); setForm(EMPTY_FORM) }}
          >
            Add Task
          </Button>
        </div>
      </div>

      {/* Urgent banner */}
      {urgentActive.length > 0 && (
        <div className="rounded-xl border border-accent-red/25 bg-accent-red/5 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-accent-red" />
            <span className="text-sm font-semibold text-accent-red">
              {urgentActive.length} Urgent Task{urgentActive.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-1.5">
            {urgentActive.map(task => <TaskCard key={task.id} task={task} />)}
          </div>
        </div>
      )}

      {/* Quick add form */}
      {showForm && (
        <div className="rounded-2xl border border-brand-green/20 bg-bg-surface p-5 animate-slide-up">
          <h3 className="text-sm font-semibold text-text-primary mb-4">New Task</h3>
          <form onSubmit={addTask} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="block text-[11px] text-text-tertiary mb-1.5 font-medium uppercase tracking-wider">Title *</label>
                <input
                  required
                  autoFocus
                  value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  className="w-full px-3 py-2 text-sm"
                  placeholder="What needs to be done?"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-tertiary mb-1.5 font-medium uppercase tracking-wider">Notes</label>
                <input
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  className="w-full px-3 py-2 text-sm"
                  placeholder="Additional details..."
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-text-tertiary mb-1.5 font-medium uppercase tracking-wider">Category</label>
                  <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className="w-full px-3 py-2 text-sm">
                    {['sales', 'operations', 'admin', 'hiring', 'finance'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-text-tertiary mb-1.5 font-medium uppercase tracking-wider">Priority</label>
                  <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} className="w-full px-3 py-2 text-sm">
                    {['low', 'medium', 'high', 'urgent'].map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-text-tertiary mb-1.5 font-medium uppercase tracking-wider">Assignee</label>
                <div className="flex gap-2">
                  {(['carlo', 'jorden', 'both'] as const).map(a => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setForm(p => ({ ...p, assignee: a }))}
                      className={clsx(
                        'flex-1 py-2 rounded-lg text-xs font-medium capitalize border transition-all',
                        form.assignee === a
                          ? a === 'carlo' ? 'bg-brand-green/20 border-brand-green/40 text-brand-green'
                            : a === 'jorden' ? 'bg-accent-blue/20 border-accent-blue/40 text-accent-blue'
                            : 'bg-accent-amber/20 border-accent-amber/40 text-accent-amber'
                          : 'border-white/[0.06] text-text-secondary hover:border-white/10 hover:text-text-primary'
                      )}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-text-tertiary mb-1.5 font-medium uppercase tracking-wider">Due Date</label>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
                  className="w-full px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end pt-1">
              <Button variant="ghost" size="sm" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button size="sm" loading={submitting} type="submit">
                Save Task
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Bulk Add Modal */}
      {showBulk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-white/[0.08] bg-[#12121A] shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <ListPlus className="w-4 h-4 text-brand-green" />
                <h2 className="text-sm font-semibold text-text-primary">Bulk Add Tasks</h2>
              </div>
              <button
                onClick={() => setShowBulk(false)}
                className="p-1 rounded-lg hover:bg-white/[0.06] text-text-tertiary hover:text-text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Textarea */}
              <div>
                <label className="block text-[11px] text-text-tertiary mb-1.5 font-medium uppercase tracking-wider">
                  Paste tasks — one per line
                </label>
                <textarea
                  autoFocus
                  rows={6}
                  value={bulkText}
                  onChange={e => {
                    setBulkText(e.target.value)
                    setBulkParsed(parseBulkText(e.target.value))
                  }}
                  placeholder={'Run new permits (Jorden)\nFix website meta descriptions (Carlo)\nTaxes (both)\nBuy WFP (Jorden)✅'}
                  className="w-full px-3 py-2 text-sm font-mono resize-none"
                />
                <p className="text-[10px] text-text-tertiary mt-1.5">
                  Use <code className="bg-white/5 px-1 rounded">(Carlo)</code>, <code className="bg-white/5 px-1 rounded">(Jorden)</code>, <code className="bg-white/5 px-1 rounded">(Both)</code> to assign · <code className="bg-white/5 px-1 rounded">✅</code> to mark done
                </p>
              </div>

              {/* Preview table */}
              {bulkParsed.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] text-text-tertiary font-medium uppercase tracking-wider">
                      Preview — {bulkParsed.length} task{bulkParsed.length !== 1 ? 's' : ''}
                    </p>
                    <p className="text-[10px] text-text-tertiary">Click cells to edit</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                          <th className="text-left px-3 py-2 text-text-tertiary font-medium w-[45%]">Task</th>
                          <th className="text-left px-3 py-2 text-text-tertiary font-medium w-[18%]">Assignee</th>
                          <th className="text-left px-3 py-2 text-text-tertiary font-medium w-[18%]">Category</th>
                          <th className="text-left px-3 py-2 text-text-tertiary font-medium w-[14%]">Status</th>
                          <th className="px-3 py-2 w-[5%]" />
                        </tr>
                      </thead>
                      <tbody>
                        {bulkParsed.map((t, i) => (
                          <tr key={i} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                            {/* Title */}
                            <td className="px-3 py-2">
                              <input
                                value={t.title}
                                onChange={e => setBulkParsed(prev => prev.map((p, j) => j === i ? { ...p, title: e.target.value } : p))}
                                className="w-full bg-transparent text-text-primary focus:outline-none focus:bg-white/[0.04] rounded px-1 -mx-1 py-0.5"
                              />
                            </td>
                            {/* Assignee */}
                            <td className="px-3 py-2">
                              <select
                                value={t.assignee}
                                onChange={e => setBulkParsed(prev => prev.map((p, j) => j === i ? { ...p, assignee: e.target.value as ParsedTask['assignee'] } : p))}
                                className={clsx(
                                  'bg-transparent text-[11px] font-medium capitalize focus:outline-none cursor-pointer',
                                  t.assignee === 'carlo'  ? 'text-brand-green' :
                                  t.assignee === 'jorden' ? 'text-accent-blue' : 'text-accent-amber'
                                )}
                              >
                                <option value="carlo">Carlo</option>
                                <option value="jorden">Jorden</option>
                                <option value="both">Both</option>
                              </select>
                            </td>
                            {/* Category */}
                            <td className="px-3 py-2">
                              <select
                                value={t.category}
                                onChange={e => setBulkParsed(prev => prev.map((p, j) => j === i ? { ...p, category: e.target.value as Task['category'] } : p))}
                                className="bg-transparent text-text-secondary text-[11px] capitalize focus:outline-none cursor-pointer"
                              >
                                {['sales', 'operations', 'admin', 'hiring', 'finance'].map(c => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            </td>
                            {/* Status */}
                            <td className="px-3 py-2">
                              <button
                                onClick={() => setBulkParsed(prev => prev.map((p, j) => j === i ? { ...p, status: p.status === 'done' ? 'todo' : 'done' } : p))}
                                className={clsx(
                                  'text-[11px] font-medium flex items-center gap-1 transition-colors',
                                  t.status === 'done' ? 'text-brand-green' : 'text-text-tertiary hover:text-text-secondary'
                                )}
                              >
                                {t.status === 'done'
                                  ? <><CheckCircle2 className="w-3 h-3" /> done</>
                                  : <><Circle className="w-3 h-3" /> todo</>
                                }
                              </button>
                            </td>
                            {/* Remove row */}
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => setBulkParsed(prev => prev.filter((_, j) => j !== i))}
                                className="text-text-tertiary hover:text-accent-red transition-colors"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-white/[0.06]">
              <span className="text-[11px] text-text-tertiary">
                {bulkParsed.length > 0 ? `${bulkParsed.length} task${bulkParsed.length !== 1 ? 's' : ''} ready to save` : 'Paste tasks above to preview'}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowBulk(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  loading={bulkSaving}
                  disabled={bulkParsed.length === 0}
                  onClick={saveBulkTasks}
                >
                  Save All
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Kanban board */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {COLUMNS.filter(c => c.key !== 'done').map(col => (
          <KanbanColumn key={col.key} col={col} />
        ))}
      </div>

      {/* Done section — collapsible, auto-expands when task is marked done */}
      {(doneTasks.length > 0 || loading) && (
        <div>
          <button
            onClick={() => setShowDone(p => !p)}
            className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors mb-3 group w-full"
          >
            <CheckCircle2 className="w-4 h-4 text-brand-green" />
            <span className="font-medium">Completed</span>
            <span className="text-[11px] text-text-tertiary font-mono">({doneTasks.length})</span>
            <span className="ml-1 text-text-tertiary group-hover:text-text-secondary transition-colors">
              {showDone ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
            {!showDone && doneTasks.length > 0 && (
              <span className="ml-auto text-[11px] text-text-tertiary italic">
                click to show · click check icon on any task to reopen
              </span>
            )}
          </button>

          {showDone && (
            <div
              className={clsx(
                'rounded-2xl border border-white/[0.06] bg-bg-surface',
                dragOverColState === 'done' && 'border-brand-green/40 bg-brand-green/5'
              )}
              onDragOver={e => onDragOver(e, 'done')}
              onDrop={e => onDrop(e, 'done')}
            >
              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="rounded-xl border border-white/[0.06] bg-bg-elevated p-3">
                      <Skeleton className="h-3 w-3/4 mb-2" />
                      <Skeleton className="h-2.5 w-1/2" />
                    </div>
                  ))
                ) : doneTasks.length === 0 ? (
                  <div className="col-span-3 text-center py-6 text-xs text-text-tertiary">
                    {dragOverColState === 'done' ? 'Drop to mark done' : 'No completed tasks'}
                  </div>
                ) : (
                  doneTasks.map(task => <TaskCard key={task.id} task={task} />)
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* RLS notice — shown only if Supabase returns permission errors */}
      <p className="text-[10px] text-text-tertiary text-center">
        If tasks aren&apos;t saving, run this in Supabase SQL editor:{' '}
        <code className="bg-white/5 px-1 py-0.5 rounded font-mono">
          ALTER TABLE tasks ENABLE ROW LEVEL SECURITY; CREATE POLICY &quot;allow_all&quot; ON tasks FOR ALL USING (true) WITH CHECK (true);
        </code>
      </p>
    </div>
  )
}
