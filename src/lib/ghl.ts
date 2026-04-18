/**
 * Go High Level (GHL) Private Integration API client
 * Uses GHL_PRIVATE_INTEGRATION_TOKEN env var
 * Uses GHL_LOCATION_ID env var (your sub-account/location ID)
 * API v2: https://services.leadconnectorhq.com
 */

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'

function getToken(): string {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN
  if (!token) throw new Error('GHL_PRIVATE_INTEGRATION_TOKEN is not set')
  return token
}

function getLocationId(): string {
  const id = process.env.GHL_LOCATION_ID
  if (!id) throw new Error('GHL_LOCATION_ID is not set')
  return id
}

async function ghlFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GHL API ${res.status} ${res.statusText}: ${body}`)
  }
  return res.json() as Promise<T>
}

// ── GHL API Types ──────────────────────────────────────────────────────────

export interface GHLFormSubmission {
  id: string
  formId: string
  name: string        // form name
  contactId: string
  submittedAt: string
  data: Record<string, unknown>   // raw form field values
}

export interface GHLContact {
  id: string
  firstName: string | null
  lastName: string | null
  name: string | null
  email: string | null
  phone: string | null
  companyName: string | null
  address1: string | null
  city: string | null
  state: string | null
  tags: string[] | null
  source: string | null
  dateAdded: string
}

export interface GHLForm {
  id: string
  name: string
  locationId: string
}

// ── API Methods ────────────────────────────────────────────────────────────

/**
 * List form submissions since a given date.
 * Returns at most `limit` results.
 */
export async function getFormSubmissions(params: {
  startAt?: string    // ISO date string
  endAt?: string
  limit?: number
  skip?: number
  formId?: string
} = {}): Promise<{ submissions: GHLFormSubmission[]; total: number }> {
  const locationId = getLocationId()
  const qs = new URLSearchParams()
  qs.set('locationId', locationId)
  qs.set('limit', String(params.limit ?? 50))
  qs.set('skip', String(params.skip ?? 0))
  if (params.startAt) qs.set('startAt', params.startAt)
  if (params.endAt) qs.set('endAt', params.endAt)
  if (params.formId) qs.set('formId', params.formId)

  const res = await ghlFetch<{
    submissions: GHLFormSubmission[]
    total: number
    count: number
  }>(`/forms/submissions?${qs}`)

  return {
    submissions: res.submissions || [],
    total: res.total || 0,
  }
}

/**
 * Get a single contact by ID.
 */
export async function getContact(contactId: string): Promise<GHLContact | null> {
  try {
    const res = await ghlFetch<{ contact: GHLContact }>(`/contacts/${contactId}`)
    return res.contact || null
  } catch {
    return null
  }
}

/**
 * List recent contacts (for diagnostics).
 */
export async function listContacts(limit = 10): Promise<GHLContact[]> {
  const locationId = getLocationId()
  const qs = new URLSearchParams({ locationId, limit: String(limit) })
  const res = await ghlFetch<{ contacts: GHLContact[] }>(`/contacts/?${qs}`)
  return res.contacts || []
}

/**
 * Check if GHL credentials are configured and valid.
 */
export async function testConnection(): Promise<{ ok: boolean; error?: string; locationId?: string }> {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN
  const locationId = process.env.GHL_LOCATION_ID
  if (!token) return { ok: false, error: 'GHL_PRIVATE_INTEGRATION_TOKEN not set' }
  if (!locationId) return { ok: false, error: 'GHL_LOCATION_ID not set' }
  try {
    await listContacts(1)
    return { ok: true, locationId }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ── Classification Helpers ─────────────────────────────────────────────────

/**
 * Extract common fields from a GHL form submission's raw data.
 */
export function parseSubmissionFields(data: Record<string, unknown>): {
  name: string
  email: string | null
  phone: string | null
  message: string | null
  service_type: string | null
  address: string | null
} {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : null)
  const name =
    str(data.name) ||
    str(data.full_name) ||
    str(data.fullName) ||
    [str(data.first_name) || str(data.firstName), str(data.last_name) || str(data.lastName)]
      .filter(Boolean)
      .join(' ') ||
    'Unknown'

  return {
    name,
    email: str(data.email) || str(data.email_address),
    phone: str(data.phone) || str(data.phone_number) || str(data.mobile),
    message: str(data.message) || str(data.notes) || str(data.comments),
    service_type: str(data.service) || str(data.service_type) || str(data.serviceType),
    address: str(data.address) || str(data.full_address) || str(data.address1),
  }
}

/**
 * Auto-tag a GHL form submission based on its content.
 */
export function autoTagGhlSubmission(fields: ReturnType<typeof parseSubmissionFields>): string[] {
  const tags: string[] = ['website-form', 'ghl']
  const text = [fields.message, fields.service_type, fields.name].join(' ').toLowerCase()

  if (/builder|gc|general contractor|construction|develop/.test(text)) tags.push('builder', 'commercial')
  else if (/homeowner|residential|home|house|condo|apartment/.test(text)) tags.push('homeowner', 'residential')

  if (/post.?construct|new build|post-con|final clean|rough clean/.test(text)) tags.push('post-construction')
  if (/window|glass/.test(text)) tags.push('window-cleaning')
  if (/pressure|power wash/.test(text)) tags.push('pressure-washing')
  if (/deep clean|detail/.test(text)) tags.push('deep-clean')
  if (/urgent|asap|emergency|rush|immediate/.test(text)) tags.push('urgent')
  if (/large|big|3000|4000|5000|6000|sqft|sq ft/.test(text)) tags.push('large-job')
  if (/commercial|office|retail|industrial/.test(text)) tags.push('commercial')

  return Array.from(new Set(tags))
}

/**
 * Determine urgency level for a GHL submission.
 */
export function ghlUrgency(fields: ReturnType<typeof parseSubmissionFields>): 'high' | 'medium' | 'low' {
  const text = [fields.message, fields.service_type].join(' ').toLowerCase()
  if (/urgent|asap|emergency|rush|today|right away/.test(text)) return 'high'
  if (/builder|gc|general contractor|construction|commercial/.test(text)) return 'high'
  if (/this week|soon|next week/.test(text)) return 'medium'
  return 'medium'
}
