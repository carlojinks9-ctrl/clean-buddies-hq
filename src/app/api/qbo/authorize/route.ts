import { NextResponse } from 'next/server'
import { getQboAuthUrl } from '@/lib/qbo'
import crypto from 'crypto'

export async function GET() {
  const state = crypto.randomBytes(16).toString('hex')
  const authUrl = getQboAuthUrl(state)

  const response = NextResponse.redirect(authUrl)
  response.cookies.set('qbo_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  return response
}
