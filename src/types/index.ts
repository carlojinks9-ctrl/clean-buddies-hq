// Core domain types for Clean Buddies HQ

export interface Client {
  id: string
  name: string
  company_name: string | null
  email: string | null
  phone: string | null
  is_gc: boolean
  notes: string | null
  jobber_id: string | null
  created_at: string
  updated_at: string
}

export interface Job {
  id: string
  title: string
  job_number: string | null
  client_id: string
  client?: Client
  status: 'active' | 'scheduled' | 'completed' | 'invoiced' | 'issue'
  contract_value_cents: number
  burdened_labor_cents: number
  total_hours: number
  gross_margin: number
  notes: string | null
  jobber_id: string | null
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
}

export interface Lead {
  id: string
  name: string
  email: string | null
  phone: string | null
  company: string | null
  address: string | null
  service_type: string | null
  message: string | null
  status: 'new' | 'contacted' | 'bid_sent' | 'won' | 'lost'
  estimated_value_cents: number | null
  source: 'website' | 'jobber' | 'referral' | 'manual' | null
  assigned_to: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Invoice {
  id: string
  invoice_number: string
  job_id: string | null
  client_id: string
  client?: Client
  job?: Job
  amount_cents: number
  balance_cents: number
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void'
  issue_date: string | null
  due_date: string | null
  paid_date: string | null
  jobber_id: string | null
  created_at: string
}

export interface Employee {
  id: string
  name: string
  role: string
  base_rate_cents: number     // base hourly in cents
  burdened_rate_cents: number // burdened hourly in cents
  status: 'active' | 'inactive' | 'on_leave'
  is_driver: boolean
  driver_qualified_at: string | null
  phone: string | null
  email: string | null
  hire_date: string | null
  created_at: string
}

export interface Task {
  id: string
  title: string
  description: string | null
  category: 'sales' | 'operations' | 'admin' | 'hiring' | 'finance'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'todo' | 'in_progress' | 'done'
  assignee: 'carlo' | 'jorden' | 'both' | null
  due_date: string | null
  job_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SupplyRequest {
  id: string
  item_name: string
  quantity: number
  unit: string | null
  job_id: string | null
  job_name: string | null
  requested_by: string
  priority: 'low' | 'medium' | 'high'
  status: 'pending' | 'ordered' | 'received'
  estimated_cost_cents: number | null
  actual_cost_cents: number | null
  home_depot_url: string | null
  notes: string | null
  telegram_message_id: string | null
  ordered_at: string | null
  received_at: string | null
  created_at: string
}

export interface ActivityFeedItem {
  id: string
  event_type: string
  title: string
  description: string | null
  metadata: Record<string, unknown> | null
  job_id: string | null
  client_id: string | null
  lead_id: string | null
  created_at: string
}

export interface PayrollImport {
  id: string
  period_start: string
  period_end: string
  total_gross_cents: number
  total_net_cents: number
  total_taxes_cents: number
  employee_count: number
  imported_at: string
  imported_by: string | null
  raw_csv: string | null
}

export interface AppSettings {
  id: string
  key: string
  value: string
  description: string | null
  updated_at: string
}

// Dashboard aggregate types
export interface KpiData {
  monthly_revenue_cents: number
  monthly_revenue_change: number   // % vs last month
  gross_margin: number             // decimal
  gross_margin_change: number
  outstanding_ar_cents: number
  active_crews: number
  active_jobs: number
}

export interface ArAgingBucket {
  label: string
  amount_cents: number
  count: number
}
