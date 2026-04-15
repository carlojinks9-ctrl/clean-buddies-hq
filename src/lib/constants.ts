// Clean Buddies business constants
export const BURDENED_LABOR_RATE = parseFloat(process.env.BURDENED_LABOR_RATE || '23.10')
export const TARGET_MARGIN = parseFloat(process.env.TARGET_MARGIN || '0.65')
export const FLOOR_MARGIN = parseFloat(process.env.FLOOR_MARGIN || '0.50')
export const EMPLOYER_COST_MULTIPLIER = 1.10 // ~10% for SS, Medicare, FUTA, AZ SUI

// Margin thresholds for color coding
export const MARGIN_GREEN_THRESHOLD = 0.65   // ≥ 65% = green
export const MARGIN_AMBER_THRESHOLD = 0.50   // 50-65% = amber
// < 50% = red

// AR aging buckets (days)
export const AR_CURRENT = 0
export const AR_30_DAYS = 30
export const AR_60_DAYS = 60
export const AR_90_DAYS = 90

// Team members with burdened hourly rates
export const TEAM_MEMBERS = [
  { name: 'Stacy McAllister',  base_rate: 2150, burdened_rate: 2365 }, // cents/hr
  { name: 'Johao Cortez',      base_rate: 2000, burdened_rate: 2205 },
  { name: 'David Stafinski',   base_rate: 2000, burdened_rate: 2200 },
  { name: 'Jesus Sanchez',     base_rate: 1855, burdened_rate: 2040 },
  { name: 'Santa Galaviz',     base_rate: 1955, burdened_rate: 2150 },
  { name: 'Rosemarie Mesa',    base_rate: 1855, burdened_rate: 2040 },
]

// Key GC clients
export const KEY_GC_CLIENTS = [
  'Chord Construction',
  'Black Stone Development',
  'Blandford Homes',
  'ValWest',
  'Luxury Remodels',
  'Design Build Custom Homes',
]

// Job statuses
export const JOB_STATUSES = ['active', 'scheduled', 'completed', 'invoiced', 'issue'] as const
export type JobStatus = typeof JOB_STATUSES[number]

// Lead statuses
export const LEAD_STATUSES = ['new', 'contacted', 'bid_sent', 'won', 'lost'] as const
export type LeadStatus = typeof LEAD_STATUSES[number]

// Task categories
export const TASK_CATEGORIES = ['sales', 'operations', 'admin', 'hiring', 'finance'] as const
export type TaskCategory = typeof TASK_CATEGORIES[number]

// Task priorities
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type TaskPriority = typeof TASK_PRIORITIES[number]

// Supply request statuses
export const SUPPLY_STATUSES = ['pending', 'ordered', 'received'] as const
export type SupplyStatus = typeof SUPPLY_STATUSES[number]
