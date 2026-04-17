import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const { service } = await request.json()
  if (!service || typeof service !== 'string') {
    return NextResponse.json({ error: 'Missing service name' }, { status: 400 })
  }

  const db = createServerClient()
  const { error } = await db.from('integration_tokens').delete().eq('service', service)

  if (error) {
    console.error('[disconnect] Delete error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[disconnect] Disconnected ${service}`)
  return NextResponse.json({ ok: true, disconnected: service })
}
