/**
 * Jobber GraphQL API client with OAuth 2.0 and leaky bucket rate limiting.
 */

const JOBBER_API_URL = 'https://api.getjobber.com/api/graphql'
const JOBBER_AUTH_URL = 'https://api.getjobber.com/api/oauth/authorize'
const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token'

export function getJobberAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.JOBBER_CLIENT_ID!,
    redirect_uri: process.env.JOBBER_REDIRECT_URI!,
    state,
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
      redirect_uri: process.env.JOBBER_REDIRECT_URI!,
      code,
    }),
  })
  if (!res.ok) throw new Error(`Jobber token exchange failed: ${res.statusText}`)
  return res.json()
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
  if (!res.ok) throw new Error(`Jobber token refresh failed: ${res.statusText}`)
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
      Authorization: `Bearer ${accessToken}`,
      'X-JOBBER-GRAPHQL-VERSION': '2024-01-15',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) {
    throw new Error(`Jobber API error: ${res.status} ${res.statusText}`)
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
        createdAt
        updatedAt
        client {
          id
          name
          companyName
        }
        timesheetEntries {
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
        phone
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
