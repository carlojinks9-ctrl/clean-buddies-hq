/**
 * CB Agent — Tool Definitions & Executor
 * Tools the intelligence agent can call against the live Supabase database.
 * All reads + writes happen here; the API route is a thin agentic loop on top.
 */

import { createServerClient } from './supabase'
import { subDays, isBefore } from 'date-fns'

// ─── Anthropic tool_use definitions ───────────────────────────────────────────

export const AGENT_TOOL_DEFINITIONS = [
  {
    name: 'get_ops_snapshot',
    description:
      'Get a high-level snapshot of current business state: new inbox items, open/urgent tasks, leads with overdue follow-up, completed jobs not yet invoiced, pending supply requests, and outstanding AR. Always call this first when the user asks what needs attention or wants a daily summary.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_inbox_items',
    description:
      'Get recent inbound items from the unified inbox: missed Quo calls, texts, GHL form submissions, Instantly email replies, Gmail. Use to triage what has come in and classify urgency.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['new', 'actioned', 'all'],
          description: 'Filter by status. Default: new',
        },
        limit: { type: 'number', description: 'Max items to return. Default: 15' },
      },
    },
  },
  {
    name: 'get_tasks',
    description:
      'Get tasks filtered by status, assignee, priority, or overdue. Use open status to see all active work. Use overdue_only to surface missed deadlines.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'open'] },
        assignee: { type: 'string', enum: ['carlo', 'jorden', 'both'] },
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        overdue_only: { type: 'boolean', description: 'Only tasks with past due_date' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_leads',
    description:
      'Get leads from the pipeline. Use stale_days to find leads with no recent activity. Use overdue_only to find leads whose next_action_due has passed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          description: 'Pipeline status: new, contacted, bid_sent, won, lost. Omit to get all active.',
        },
        overdue_only: {
          type: 'boolean',
          description: 'Only leads with next_action_due in the past',
        },
        stale_days: {
          type: 'number',
          description: 'Only leads with no activity in the last N days',
        },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_jobs',
    description:
      'Get jobs filtered by status. Use needs_invoicing=true to find jobs that are completed but not yet invoiced.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'scheduled', 'completed', 'invoiced', 'issue', 'all'],
        },
        needs_invoicing: {
          type: 'boolean',
          description: 'Return only completed jobs not yet in invoiced status',
        },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_supply_requests',
    description: 'Get supply requests from the crew, filtered by status. Pending items are unordered.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['pending', 'ordered', 'received', 'all'] },
      },
    },
  },
  {
    name: 'create_task',
    description:
      'Create a new task in the system. Use this when you identify work that needs to be tracked. Always confirm what was created after.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short, action-oriented title' },
        description: { type: 'string', description: 'More detail about what needs to happen' },
        category: { type: 'string', enum: ['sales', 'operations', 'admin', 'hiring', 'finance'] },
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        assignee: { type: 'string', enum: ['carlo', 'jorden', 'both'] },
        due_date: { type: 'string', description: 'Due date as YYYY-MM-DD' },
      },
      required: ['title', 'category', 'priority'],
    },
  },
  {
    name: 'update_task',
    description:
      'Update an existing task. Provide the task ID plus only the fields you want to change.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        assignee: { type: 'string', enum: ['carlo', 'jorden', 'both'] },
        due_date: { type: 'string', description: 'YYYY-MM-DD or empty string to clear' },
        description: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_lead',
    description: 'Create a new lead record in the pipeline. Use when an inbound item is a new potential client.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        company: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        service_type: { type: 'string' },
        source: {
          type: 'string',
          enum: ['website', 'jobber', 'referral', 'manual', 'quo', 'gmail', 'instantly', 'ghl'],
        },
        notes: { type: 'string' },
        urgency: { type: 'string', enum: ['high', 'medium', 'low'] },
        owner: { type: 'string', enum: ['carlo', 'jorden'] },
        next_action: { type: 'string' },
        next_action_due: { type: 'string', description: 'YYYY-MM-DD' },
        estimated_value_cents: { type: 'number' },
      },
      required: ['name', 'source'],
    },
  },
  {
    name: 'update_lead',
    description:
      'Update an existing lead: advance pipeline status, set urgency/owner, log next action, update notes or estimated value.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['new', 'contacted', 'bid_sent', 'won', 'lost'] },
        urgency: { type: 'string', enum: ['high', 'medium', 'low'] },
        owner: { type: 'string', enum: ['carlo', 'jorden'] },
        next_action: { type: 'string' },
        next_action_due: { type: 'string', description: 'YYYY-MM-DD or empty to clear' },
        notes: { type: 'string' },
        estimated_value_cents: { type: 'number' },
      },
      required: ['id'],
    },
  },
]

// ─── Action record (shown as cards in the UI after the agent acts) ─────────────

export interface AgentAction {
  type: 'task_created' | 'task_updated' | 'lead_created' | 'lead_updated'
  label: string
  id: string
}

// ─── Tool executor ─────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<{ result: unknown; action?: AgentAction }> {
  const db = createServerClient()
  const now = new Date()

  switch (name) {
    // ── READ: full business snapshot ───────────────────────────────────────
    case 'get_ops_snapshot': {
      const [inboxRes, tasksRes, leadsRes, jobsRes, invoicesRes, suppliesRes] =
        await Promise.all([
          db
            .from('inbound_items')
            .select('id, source, urgency, sla_breached, contact_name, subject, created_at')
            .eq('status', 'new')
            .order('created_at', { ascending: false })
            .limit(10),
          db
            .from('tasks')
            .select('id, title, priority, status, assignee, due_date, category')
            .in('status', ['todo', 'in_progress'])
            .order('due_date', { ascending: true })
            .limit(15),
          db
            .from('leads')
            .select('id, name, company, status, urgency, next_action, next_action_due, owner, estimated_value_cents, last_activity_at, created_at')
            .not('status', 'eq', 'won')
            .not('status', 'eq', 'lost')
            .order('created_at', { ascending: false })
            .limit(20),
          db
            .from('jobs')
            .select('id, title, status, contract_value_cents, start_date, end_date')
            .in('status', ['active', 'completed', 'issue'])
            .order('updated_at', { ascending: false })
            .limit(15),
          db
            .from('invoices')
            .select('id, invoice_number, amount_cents, balance_cents, status, due_date')
            .in('status', ['sent', 'overdue'])
            .order('due_date', { ascending: true })
            .limit(10),
          db
            .from('supply_requests')
            .select('id, item_name, quantity, priority, requested_by, job_name, created_at')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(8),
        ])

      const tasks = tasksRes.data || []
      const overdueTasks = tasks.filter(
        t => t.due_date && new Date(t.due_date) < now
      )
      const urgentTasks = tasks.filter(
        t => t.priority === 'urgent' || t.priority === 'high'
      )

      const leads = leadsRes.data || []
      const overdueFollowUps = leads.filter(
        l => l.next_action_due && new Date(l.next_action_due) < now
      )
      const staleLeads = leads.filter(l => {
        const lastTouch = l.last_activity_at
          ? new Date(l.last_activity_at)
          : new Date(l.created_at)
        return isBefore(lastTouch, subDays(now, 3)) && l.status !== 'new'
      })

      const jobs = jobsRes.data || []
      const completedNotInvoiced = jobs.filter(j => j.status === 'completed')
      const issueJobs = jobs.filter(j => j.status === 'issue')

      const inbox = inboxRes.data || []
      const slaBreached = inbox.filter(i => i.sla_breached)

      return {
        result: {
          inbox: {
            new_count: inbox.length,
            sla_breached_count: slaBreached.length,
            recent: inbox.slice(0, 5),
          },
          tasks: {
            open_count: tasks.length,
            urgent_or_high: urgentTasks.length,
            overdue: overdueTasks.length,
            overdue_list: overdueTasks.slice(0, 4),
            urgent_list: urgentTasks.filter(t => t.priority === 'urgent').slice(0, 3),
          },
          leads: {
            active_count: leads.length,
            overdue_followup_count: overdueFollowUps.length,
            overdue_followup_list: overdueFollowUps.slice(0, 4),
            stale_count: staleLeads.length,
            stale_list: staleLeads.slice(0, 3),
          },
          jobs: {
            active_count: jobs.filter(j => j.status === 'active').length,
            issue_count: issueJobs.length,
            completed_not_invoiced_count: completedNotInvoiced.length,
            completed_not_invoiced_list: completedNotInvoiced.slice(0, 4),
          },
          ar: {
            outstanding_invoices: (invoicesRes.data || []).length,
            overdue_count: (invoicesRes.data || []).filter(i => i.status === 'overdue').length,
            total_balance_cents: (invoicesRes.data || []).reduce(
              (s, i) => s + (i.balance_cents || 0),
              0
            ),
          },
          supplies: {
            pending_count: (suppliesRes.data || []).length,
            urgent_count: (suppliesRes.data || []).filter(r => r.priority === 'high').length,
            list: suppliesRes.data || [],
          },
        },
      }
    }

    // ── READ: inbox items ─────────────────────────────────────────────────
    case 'get_inbox_items': {
      const statusFilter = (input.status as string) || 'new'
      const limit = Number(input.limit) || 15

      let query = db
        .from('inbound_items')
        .select(
          'id, source, contact_name, phone, email, company, subject, body_preview, urgency, tags, status, sla_deadline, sla_breached, lead_id, created_at'
        )
        .order('sla_breached', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit)

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      const { data } = await query
      return { result: { items: data || [], count: (data || []).length } }
    }

    // ── READ: tasks ───────────────────────────────────────────────────────
    case 'get_tasks': {
      let query = db
        .from('tasks')
        .select('id, title, description, category, priority, status, assignee, due_date, created_at')

      const status = input.status as string
      if (status === 'open') {
        query = query.in('status', ['todo', 'in_progress'])
      } else if (status) {
        query = query.eq('status', status)
      }

      if (input.assignee) query = query.eq('assignee', input.assignee as string)
      if (input.priority) query = query.eq('priority', input.priority as string)
      if (input.overdue_only) {
        query = query.lt('due_date', now.toISOString()).not('due_date', 'is', null)
      }

      query = query
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(Number(input.limit) || 20)

      const { data } = await query
      return { result: { tasks: data || [], count: (data || []).length } }
    }

    // ── READ: leads ───────────────────────────────────────────────────────
    case 'get_leads': {
      let query = db
        .from('leads')
        .select(
          'id, name, company, email, phone, service_type, status, urgency, owner, next_action, next_action_due, estimated_value_cents, source, notes, last_activity_at, created_at'
        )

      if (input.status) {
        query = query.eq('status', input.status as string)
      } else {
        query = query.not('status', 'eq', 'won').not('status', 'eq', 'lost')
      }

      if (input.overdue_only) {
        query = query.lt('next_action_due', now.toISOString()).not('next_action_due', 'is', null)
      }

      query = query
        .order('created_at', { ascending: false })
        .limit(Number(input.limit) || 20)

      let { data } = await query
      let list = data || []

      // Client-side stale filter
      if (input.stale_days) {
        const cutoff = subDays(now, Number(input.stale_days))
        list = list.filter(l => {
          const lastTouch = l.last_activity_at
            ? new Date(l.last_activity_at)
            : new Date(l.created_at)
          return isBefore(lastTouch, cutoff)
        })
      }

      return { result: { leads: list, count: list.length } }
    }

    // ── READ: jobs ────────────────────────────────────────────────────────
    case 'get_jobs': {
      let query = db
        .from('jobs')
        .select(
          'id, title, job_number, status, contract_value_cents, burdened_labor_cents, gross_margin, start_date, end_date, client_id'
        )

      if (input.needs_invoicing) {
        query = query.eq('status', 'completed')
      } else if (input.status && input.status !== 'all') {
        query = query.eq('status', input.status as string)
      }

      query = query
        .order('updated_at', { ascending: false })
        .limit(Number(input.limit) || 20)

      const { data } = await query
      return { result: { jobs: data || [], count: (data || []).length } }
    }

    // ── READ: supply requests ─────────────────────────────────────────────
    case 'get_supply_requests': {
      const status = (input.status as string) || 'pending'
      let query = db
        .from('supply_requests')
        .select(
          'id, item_name, quantity, unit, job_name, requested_by, priority, status, estimated_cost_cents, created_at'
        )
        .order('created_at', { ascending: false })

      if (status !== 'all') {
        query = query.eq('status', status)
      }

      const { data } = await query
      return { result: { requests: data || [], count: (data || []).length } }
    }

    // ── WRITE: create task ────────────────────────────────────────────────
    case 'create_task': {
      const { title, description, category, priority, assignee, due_date } =
        input as Record<string, string | undefined>
      const { data, error } = await db
        .from('tasks')
        .insert({
          title,
          description: description || null,
          category,
          priority,
          assignee: assignee || null,
          due_date: due_date || null,
          status: 'todo',
          created_by: 'agent',
        })
        .select('id, title, priority, assignee, due_date')
        .single()

      if (error) return { result: { success: false, error: error.message } }
      return {
        result: { success: true, created: data },
        action: { type: 'task_created', label: title as string, id: data.id },
      }
    }

    // ── WRITE: update task ────────────────────────────────────────────────
    case 'update_task': {
      const { id, ...fields } = input as Record<string, string>
      const updates: Record<string, string | null> = {}
      if (fields.status !== undefined) updates.status = fields.status
      if (fields.priority !== undefined) updates.priority = fields.priority
      if (fields.assignee !== undefined) updates.assignee = fields.assignee
      if (fields.due_date !== undefined) updates.due_date = fields.due_date || null
      if (fields.description !== undefined) updates.description = fields.description

      const { data, error } = await db
        .from('tasks')
        .update(updates)
        .eq('id', id)
        .select('id, title, status')
        .single()

      if (error) return { result: { success: false, error: error.message } }
      return {
        result: { success: true, updated: data },
        action: { type: 'task_updated', label: data?.title ?? 'task', id },
      }
    }

    // ── WRITE: create lead ────────────────────────────────────────────────
    case 'create_lead': {
      const inp = input as Record<string, unknown>
      const { data, error } = await db
        .from('leads')
        .insert({
          name: inp.name as string,
          company: (inp.company as string) || null,
          email: (inp.email as string) || null,
          phone: (inp.phone as string) || null,
          service_type: (inp.service_type as string) || null,
          source: (inp.source as string) || 'manual',
          notes: (inp.notes as string) || null,
          urgency: (inp.urgency as string) || 'medium',
          owner: (inp.owner as string) || null,
          next_action: (inp.next_action as string) || null,
          next_action_due: (inp.next_action_due as string) || null,
          estimated_value_cents:
            typeof inp.estimated_value_cents === 'number'
              ? inp.estimated_value_cents
              : null,
          status: 'new',
          last_activity_at: now.toISOString(),
        })
        .select('id, name')
        .single()

      if (error) return { result: { success: false, error: error.message } }
      return {
        result: { success: true, created: data },
        action: { type: 'lead_created', label: data?.name ?? 'lead', id: data.id },
      }
    }

    // ── WRITE: update lead ────────────────────────────────────────────────
    case 'update_lead': {
      const { id, ...fields } = input as Record<string, unknown>
      const updates: Record<string, unknown> = {
        last_activity_at: now.toISOString(),
      }
      if (fields.status !== undefined) updates.status = fields.status
      if (fields.urgency !== undefined) updates.urgency = fields.urgency
      if (fields.owner !== undefined) updates.owner = fields.owner
      if (fields.next_action !== undefined) updates.next_action = fields.next_action
      if (fields.next_action_due !== undefined)
        updates.next_action_due = (fields.next_action_due as string) || null
      if (fields.notes !== undefined) updates.notes = fields.notes
      if (fields.estimated_value_cents !== undefined)
        updates.estimated_value_cents = fields.estimated_value_cents

      const { data, error } = await db
        .from('leads')
        .update(updates)
        .eq('id', id as string)
        .select('id, name, status')
        .single()

      if (error) return { result: { success: false, error: error.message } }
      return {
        result: { success: true, updated: data },
        action: { type: 'lead_updated', label: data?.name ?? 'lead', id: id as string },
      }
    }

    default:
      return { result: { error: `Unknown tool: ${name}` } }
  }
}
