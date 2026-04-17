'use client'
import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Zap, Eye, EyeOff, Lock, Mail } from 'lucide-react'

const ALLOWED_EMAIL = 'info@getcleanbuddies.com'

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'Sign-in failed. Please try again.',
  no_code: 'OAuth flow was cancelled.',
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState(ALLOWED_EMAIL)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const errCode = searchParams.get('error')
    if (errCode) setError(ERROR_MESSAGES[errCode] ?? 'Sign-in failed. Please try again.')
  }, [searchParams])

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        setError(signInError.message === 'Invalid login credentials'
          ? 'Incorrect email or password.'
          : signInError.message)
        return
      }
      // Full reload so middleware reads fresh session cookie
      window.location.href = '/'
    } catch (err) {
      console.error('Sign-in error:', err)
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="relative w-10 h-10 rounded-xl bg-brand-green/20 border border-brand-green/30 flex items-center justify-center">
            <Zap className="w-5 h-5 text-brand-green" />
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand-green pulse-live" />
          </div>
          <div>
            <div className="text-base font-bold text-text-primary">Clean Buddies</div>
            <div className="text-[11px] text-text-tertiary font-medium tracking-wider uppercase">Command Center</div>
          </div>
        </div>

        {/* Card */}
        <div className="card p-6 space-y-5">
          <div>
            <h1 className="text-lg font-semibold text-text-primary mb-1">Welcome back</h1>
            <p className="text-sm text-text-secondary">Sign in to access the command center</p>
          </div>

          {/* Error */}
          {error && (
            <div className="px-3 py-2.5 rounded-lg bg-accent-red/10 border border-accent-red/20 text-sm text-accent-red">
              {error}
            </div>
          )}

          {/* Email / Password form */}
          <form onSubmit={handleEmailSignIn} className="space-y-4">
            <div>
              <label className="block text-[11px] text-text-tertiary mb-1.5 font-medium uppercase tracking-wider">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@getcleanbuddies.com"
                  className="w-full pl-9 pr-3 py-2.5 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-text-tertiary mb-1.5 font-medium uppercase tracking-wider">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoFocus
                  placeholder="Enter your password"
                  className="w-full pl-9 pr-10 py-2.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg bg-brand-green hover:bg-brand-green-dim text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-h-[44px]"
            >
              {loading && (
                <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              )}
              Sign In
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-text-tertiary mt-4">
          Clean Buddies LLC · Greater Phoenix Metro
        </p>
      </div>
    </div>
  )
}
