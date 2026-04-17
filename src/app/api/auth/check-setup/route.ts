import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  try {
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data } = await adminClient.auth.admin.listUsers()
    const exists = (data?.users || []).some(u => u.email === 'info@getcleanbuddies.com')
    return NextResponse.json({ exists })
  } catch {
    // If check fails, assume account exists (shows login form, safer default)
    return NextResponse.json({ exists: true })
  }
}
