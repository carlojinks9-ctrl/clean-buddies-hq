'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Zap, Eye, EyeOff, Lock, Mail } from 'lucide-react'

const EMAIL = 'info@getcleanbuddies.com'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'loading' | 'login' | 'register'>('loading')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/auth/check-setup')
      .then(r => r.json())
      .then(data => setMode(data.exists ? 'login' : 'register'))
      .catch(() => setMode('login'))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (mode === 'register') {
        if (password !== confirmPassword) {
          setError('Passwords do not match')
          return
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters')
          return
        }
        const { error: signUpError } = await supabase.auth.signUp({ email: EMAIL, password })
        if (signUpError) {
          setError(signUpError.message)
          return
        }
        // Auto sign-in after registration
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: EMAIL, password })
        if (signInError) {
          setError('Account created — please sign in.')
          setMode('login')
          setPassword('')
          setConfirmPassword('')
          return
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: EMAIL, password })
        if (signInError) {
          setError('Incorrect password. Please try again.')
          return
        }
      }
      router.push('/')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  if (mode === 'loading') {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-brand-green border-t-transparent animate-spin" />
      </div>
    )
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
        <div className="card p-6">
          <h1 className="text-lg font-semibold text-text-primary mb-1">
            {mode === 'register' ? 'Set up your account' : 'Welcome back'}
          </h1>
          <p className="text-sm text-text-secondary mb-6">
            {mode === 'register'
              ? 'Create a password to get started'
              : 'Sign in to access the command center'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email — fixed */}
            <div>
              <label className="block text-[11px] text-text-tertiary mb-1.5 font-medium uppercase tracking-wider">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
                <input
                  type="email"
                  value={EMAIL}
                  readOnly
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-bg-elevated border border-white/[0.06] rounded-lg text-text-secondary cursor-not-allowed"
                />
              </div>
            </div>

            {/* Password */}
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
                  placeholder={mode === 'register' ? 'Create a password (min 8 chars)' : 'Enter your password'}
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

            {/* Confirm password — register only */}
            {mode === 'register' && (
              <div>
                <label className="block text-[11px] text-text-tertiary mb-1.5 font-medium uppercase tracking-wider">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                    placeholder="Re-enter your password"
                    className="w-full pl-9 pr-3 py-2.5 text-sm"
                  />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="px-3 py-2.5 rounded-lg bg-accent-red/10 border border-accent-red/20 text-sm text-accent-red">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg bg-brand-green hover:bg-brand-green-dim text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-h-[44px]"
            >
              {loading && (
                <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              )}
              {mode === 'register' ? 'Create Account & Sign In' : 'Sign In'}
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
