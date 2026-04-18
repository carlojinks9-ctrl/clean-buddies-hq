/**
 * Quo (formerly OpenPhone) API client
 * Base URL: https://api.openphone.com/v1
 * Auth: Authorization: {API_KEY} — no Bearer prefix
 */

const QUO_BASE = 'https://api.openphone.com/v1'

function getApiKey(): string {
  const key = process.env.QUO_API_KEY
  if (!key) throw new Error('QUO_API_KEY is not set')
  return key
}

async function quoFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${QUO_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: getApiKey(),
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Quo API ${res.status} ${res.statusText}: ${body}`)
  }
  return res.json() as Promise<T>
}

// ── Quo API response types ────────────────────────────────────────────────

export interface QuoApiCall {
  id: string
  direction: 'inbound' | 'outbound'
  from: string
  to: string
  duration: number | null        // seconds
  status: string                 // completed, missed, voicemail, no-answer, busy
  createdAt: string
  phoneNumberId: string | null
  userId: string | null
  recording?: { url: string } | null
  voicemail?: { url: string } | null
  summary?: string | null        // AI summary from OpenPhone
  transcript?: string | null
  tags?: string[] | null
}

export interface QuoApiMessage {
  id: string
  direction: 'inbound' | 'outbound'
  from: string
  to: string
  body: string | null
  status: string
  createdAt: string
  phoneNumberId: string | null
  userId: string | null
  media?: Array<{ url: string; contentType: string }> | null
}

export interface QuoApiPhoneNumber {
  id: string
  name: string | null
  formattedNumber: string
  rawNumber: string
  status: string
}

export interface QuoApiContact {
  id: string
  name: string | null
  company: string | null
  emails: Array<{ value: string }> | null
  phoneNumbers: Array<{ value: string }> | null
  createdAt: string
}

export interface QuoApiWebhook {
  id: string
  url: string
  events: string[]
  status: string
}

// ── API methods ────────────────────────────────────────────────────────────

export async function getPhoneNumbers(): Promise<QuoApiPhoneNumber[]> {
  const data = await quoFetch<{ data: QuoApiPhoneNumber[] }>('/phone-numbers')
  return data.data || []
}

export async function getCalls(params: {
  phoneNumberId?: string
  maxResults?: number
  pageToken?: string
} = {}): Promise<{ data: QuoApiCall[]; nextPageToken: string | null }> {
  const qs = new URLSearchParams({ maxResults: String(params.maxResults ?? 50) })
  if (params.phoneNumberId) qs.set('phoneNumberId', params.phoneNumberId)
  if (params.pageToken) qs.set('pageToken', params.pageToken)
  const res = await quoFetch<{ data: QuoApiCall[]; meta?: { nextPageToken?: string } }>(`/calls?${qs}`)
  return { data: res.data || [], nextPageToken: res.meta?.nextPageToken ?? null }
}

export async function getMessages(params: {
  phoneNumberId?: string
  maxResults?: number
  pageToken?: string
} = {}): Promise<{ data: QuoApiMessage[]; nextPageToken: string | null }> {
  const qs = new URLSearchParams({ maxResults: String(params.maxResults ?? 50) })
  if (params.phoneNumberId) qs.set('phoneNumberId', params.phoneNumberId)
  if (params.pageToken) qs.set('pageToken', params.pageToken)
  const res = await quoFetch<{ data: QuoApiMessage[]; meta?: { nextPageToken?: string } }>(`/messages?${qs}`)
  return { data: res.data || [], nextPageToken: res.meta?.nextPageToken ?? null }
}

export async function getContacts(params: {
  maxResults?: number
  pageToken?: string
} = {}): Promise<{ data: QuoApiContact[]; nextPageToken: string | null }> {
  const qs = new URLSearchParams({ maxResults: String(params.maxResults ?? 100) })
  if (params.pageToken) qs.set('pageToken', params.pageToken)
  const res = await quoFetch<{ data: QuoApiContact[]; meta?: { nextPageToken?: string } }>(`/contacts?${qs}`)
  return { data: res.data || [], nextPageToken: res.meta?.nextPageToken ?? null }
}

export async function listWebhooks(): Promise<QuoApiWebhook[]> {
  const data = await quoFetch<{ data: QuoApiWebhook[] }>('/webhooks')
  return data.data || []
}

export async function registerWebhook(url: string, events: string[]): Promise<QuoApiWebhook> {
  const data = await quoFetch<{ data: QuoApiWebhook }>('/webhooks', {
    method: 'POST',
    body: JSON.stringify({ url, events }),
  })
  return data.data
}

export async function deleteWebhook(id: string): Promise<void> {
  await quoFetch(`/webhooks/${id}`, { method: 'DELETE' })
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Strip non-digits and take last 10 for consistent comparison */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10)
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

// Statuses the Quo REST API returns for calls (used in sync route, not webhook)
// Note: the webhook call.completed event always has status="completed" — use answeredAt to detect misses
export const QUO_MISSED_STATUSES = new Set(['missed', 'no-answer', 'busy', 'voicemail'])

// All supported Quo webhook event types (configure these in Quo Settings → Webhooks)
// Note: webhooks must be created manually in the Quo app — there is no public API for webhook registration
export const QUO_WEBHOOK_EVENTS = [
  'call.ringing',
  'call.completed',
  'call.recording.completed',
  'call.summary.completed',
  'call.transcript.completed',
  'message.received',
  'message.delivered',    // outbound delivery confirmation (NOT message.sent)
  'contact.updated',
  'contact.deleted',
]
