/**
 * Jobber GraphQL API client with OAuth 2.0 and leaky bucket rate limiting.
 */

const JOBBER_API_URL = 'https://api.getjobber.com/graphql'
const JOBBER_AUTH_URL = 'https://api.getjobber.com/api/oauth/authorize'
const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token'

// Derive redirect URI from app URL so localhost and production both work automatically.
// Vercel / prod: set NEXT_PUBLIC_APP_URL=https://clean-buddies-hq.vercel.app
// Local dev:     NEXT_PUBLIC_APP_URL=http://localhost:3000 (already in .env.local)
function getRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.JOBBER_REDIRECT_URI
  if (!base) throw new Error('NEXT_PUBLIC_APP_URL is not set')
  return base.replace(/\/$/, '') + '/api/jobber/callback'
}

export function getJobberAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.JOBBER_CLIENT_ID!,
    redirect_uri: getRedirectUri(),
    state,
    // Request all scopes needed for clients, jobs, invoices, timesheets
    scope: 'read_clients write_clients read_jobs write_jobs read_invoices write_invoices',
  })
  return `${JOBBER_AUTH_URL}?${params}`
}

export async function exchangeJobberCode(code: string): Promise<JobberTokenResponse> {
  const res = await fetch(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.JOBBER_CLIENT_ID!,
      client_secret: process.env.JOBBER_CLIENT_SECRET!,
      redirect_uri: getRedirectUri(),
      code,
    }),
  })
  if (!res.ok) throw new Error(`Jobber token exchange failed: ${res.statusText}`)
  return res.json()
}

// Map Jobber's uppercase job status strings to our DB enum values
export function mapJobberJobStatus(status: string): string {
  const map: Record<string, string> = {
    ACTIVE:               'active',
    REQUIRES_INVOICING:   'completed',
    INVOICED:             'invoiced',
    AWAITING_PAYMENT:     'invoiced',
    DRAFT:                'scheduled',
    COMPLETED:            'completed',
    ARCHIVED:             'completed',
    LATE:                 'issue',
  }
  return map[status?.toUpperCase()] ?? 'active'
}

// Map Jobber invoice statuses to our DB enum values
export function mapJobberInvoiceStatus(status: string, dueDate?: string | null): string {
  const s = status?.toUpperCase()
  if (s === 'PAID') return 'paid'
  if (s === 'DRAFT') return 'draft'
  if (s === 'BAD_DEBT' || s === 'CONVERTED_TO_CREDIT') return 'void'
  // SENT / AWAITING_PAYMENT — check if past due
  if (dueDate && new Date(dueDate) < new Date()) return 'overdue'
  return 'sent'
}

export async function refreshJobberToken(refreshToken: string): Promise<JobberTokenResponse> {
  const res = await fetch(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.JOBBER_CLIENT_ID!,
      client_secret: process.env.JOBBER_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Jobber token refresh failed: ${res.status} ${res.statusText} — ${body}`)
  }
  return res.json()
}

export async function jobberQuery<T = unknown>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(JOBBER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-JOBBER-GRAPHQL-VERSION': '2024-01-15',
      'User-Agent': 'CleanBuddiesHQ/1.0',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // Distinguish auth failures (reconnect required) from other errors
    if (res.status === 401 || res.status === 403) {
      throw new Error(`JOBBER_UNAUTHORIZED: ${res.status} — Token invalid or revoked. Reconnect required. Detail: ${body}`)
    }
    throw new Error(`Jobber API error: ${res.status} ${res.statusText} — ${body}`)
  }

  const json = await res.json()
  if (json.errors?.length) {
    throw new Error(`Jobber GraphQL errors: ${JSON.stringify(json.errors)}`)
  }

  return json.data as T
}

// ---- GraphQL Queries ----

export const JOBS_QUERY = `
  query GetJobs($cursor: String) {
    jobs(first: 50, after: $cursor) {
      nodes {
        id
        title
        jobNumber
        total { value currency }
        jobStatus
        startAt
        completedAt
        createdAt
        updatedAt
        client {
          id
          name
          companyName
        }
        timesheetEntries(first: 100) {
          nodes {
            id
            finalDuration
            employee { name }
            startedAt
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

export const CLIENTS_QUERY = `
  query GetClients($cursor: String) {
    clients(first: 50, after: $cursor) {
      nodes {
        id
        name
        companyName
        email
        phones { number }
        createdAt
        isCompany
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

export const INVOICES_QUERY = `
  query GetInvoices($cursor: String) {
    invoices(first: 50, after: $cursor) {
      nodes {
        id
        invoiceNumber
        total { value currency }
        balance { value currency }
        status
        dueDate
        issuedDate
        client {
          id
          name
          companyName
        }
        job { id title }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

export interface JobberTokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  scope: string
}
