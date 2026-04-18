/**
 * Instantly.ai API client
 * Uses INSTANTLY_API_KEY env var
 * v1 API: https://api.instantly.ai/api/v1
 */

const INSTANTLY_BASE = 'https://api.instantly.ai/api/v1'

function getApiKey(): string {
  const key = process.env.INSTANTLY_API_KEY
  if (!key) throw new Error('INSTANTLY_API_KEY is not set')
  return key
}

async function instantlyFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${INSTANTLY_BASE}${path}${sep}api_key=${getApiKey()}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Instantly API ${res.status} ${res.statusText}: ${body}`)
  }
  return res.json() as Promise<T>
}

// ── Instantly API Types ────────────────────────────────────────────────────

export interface InstantlyCampaign {
  id: string
  name: string
  status: string   // 'active' | 'paused' | 'completed'
  timestamp_created: string
}

export interface InstantlyEmail {
  id: string
  campaign_id: string
  campaign_name: string | null
  from_address: string
  to_address: string
  subject: string | null
  body: string | null
  timestamp_received: string
  read: boolean
  reply_to_type: string  // 'received' means it's a reply from the prospect
}

export interface InstantlyLead {
  id: string
  campaign_id: string
  email: string
  first_name: string | null
  last_name: string | null
  company_name: string | null
  status: number
  timestamp_created: string
  variables: Record<string, string>
}

// ── API Methods ────────────────────────────────────────────────────────────

/**
 * List campaigns.
 */
export async function getCampaigns(): Promise<InstantlyCampaign[]> {
  const res = await instantlyFetch<InstantlyCampaign[]>('/campaign/list')
  return Array.isArray(res) ? res : []
}

/**
 * Get email replies received (inbound replies from prospects).
 */
export async function getReceivedEmails(params: {
  campaignId?: string
  limit?: number
  skip?: number
} = {}): Promise<InstantlyEmail[]> {
  const qs = new URLSearchParams({
    limit: String(params.limit ?? 20),
    skip: String(params.skip ?? 0),
    reply_to_type: 'received',
  })
  if (params.campaignId) qs.set('campaign_id', params.campaignId)

  const res = await instantlyFetch<InstantlyEmail[]>(`/emails/list?${qs}`)
  return Array.isArray(res) ? res : []
}

/**
 * Check API key validity.
 */
export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.INSTANTLY_API_KEY
  if (!key) return { ok: false, error: 'INSTANTLY_API_KEY not set' }
  try {
    await getCampaigns()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ── Classification Helpers ─────────────────────────────────────────────────

/**
 * Analyze email text to determine sentiment/intent.
 */
export function classifyReply(subject: string | null, body: string | null): {
  sentiment: 'positive' | 'neutral' | 'negative' | 'out_of_office' | 'unsubscribe' | 'unknown'
  tags: string[]
} {
  const text = [subject, body].join(' ').toLowerCase()

  // Out of office / auto-reply
  if (/out of (the )?office|auto.?reply|on vacation|away from|automatic reply|maternity|paternity/.test(text)) {
    return { sentiment: 'out_of_office', tags: ['auto-reply'] }
  }

  // Unsubscribe / not interested
  if (/unsubscribe|remove me|stop emailing|not interested|do not contact|don't contact|take me off/.test(text)) {
    return { sentiment: 'unsubscribe', tags: ['unsubscribe', 'not-interested'] }
  }

  // Negative / rejection
  if (/no thank|not looking|already have|happy with|not a good fit|too expensive|budget|decline/.test(text)) {
    return { sentiment: 'negative', tags: ['rejection', 'not-interested'] }
  }

  // Positive signals
  const positiveSignals = [
    /interest(ed)?|tell me more|sounds good|let's talk|set up a call|schedule|when can|available|pricing|how much|quote|estimate|proposal/,
    /yes|absolutely|great|perfect|definitely|would like|looking for|need|require|help me|reach out/,
    /can you|could you|do you|what is|how do|what do you/,
  ]
  const isPositive = positiveSignals.some(re => re.test(text))
  if (isPositive) {
    const tags: string[] = ['positive-reply']
    if (/builder|gc|general contractor|construction|commercial|developer/.test(text)) tags.push('builder', 'commercial')
    if (/property manager|pm|hoa/.test(text)) tags.push('property-manager')
    if (/refer|referral/.test(text)) tags.push('referral')
    if (/estimat|quot|pric/.test(text)) tags.push('estimate-request')
    if (/schedule|when|available|call|meeting/.test(text)) tags.push('scheduling')
    return { sentiment: 'positive', tags }
  }

  // Neutral — follow up
  if (/follow.?up|checking in|just wanted|touch base/.test(text)) {
    return { sentiment: 'neutral', tags: ['follow-up'] }
  }

  return { sentiment: 'unknown', tags: [] }
}

/**
 * Determine owner assignment for an Instantly reply.
 */
export function assignOwner(email: InstantlyEmail): 'carlo' | 'jorden' {
  // All Instantly outbound is sales — default to Carlo
  return 'carlo'
}
