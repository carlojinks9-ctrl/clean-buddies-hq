/**
 * QuickBooks Online OAuth 2.0 client and API helpers.
 */

const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const QBO_API_BASE =
  process.env.QBO_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com/v3/company'
    : 'https://sandbox-quickbooks.api.intuit.com/v3/company'

const QBO_SCOPES = 'com.intuit.quickbooks.accounting'

export function getQboAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.QBO_CLIENT_ID!,
    redirect_uri: process.env.QBO_REDIRECT_URI!,
    scope: QBO_SCOPES,
    state,
  })
  return `${QBO_AUTH_URL}?${params}`
}

export async function exchangeQboCode(code: string, realmId: string): Promise<QboTokenResponse> {
  const credentials = Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.QBO_REDIRECT_URI!,
    }),
  })

  if (!res.ok) throw new Error(`QBO token exchange failed: ${res.statusText}`)
  const data = await res.json()
  return { ...data, realm_id: realmId }
}

export async function refreshQboToken(refreshToken: string): Promise<QboTokenResponse> {
  const credentials = Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) throw new Error(`QBO token refresh failed: ${res.statusText}`)
  return res.json()
}

async function qboGet(accessToken: string, realmId: string, path: string) {
  const res = await fetch(`${QBO_API_BASE}/${realmId}/${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`QBO API error: ${res.statusText}`)
  return res.json()
}

export async function getPnlReport(accessToken: string, realmId: string, startDate: string, endDate: string) {
  return qboGet(
    accessToken,
    realmId,
    `reports/ProfitAndLoss?start_date=${startDate}&end_date=${endDate}&accounting_method=Accrual`
  )
}

export async function getArAgingReport(accessToken: string, realmId: string) {
  return qboGet(accessToken, realmId, 'reports/AgedReceivableDetail?aging_period=30&num_periods=4')
}

export interface QboTokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  x_refresh_token_expires_in: number
  realm_id?: string
}
