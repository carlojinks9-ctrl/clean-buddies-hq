'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import {
  LayoutDashboard,
  Briefcase,
  Users,
  DollarSign,
  HardHat,
  ShoppingCart,
  CheckSquare,
  Settings,
  Zap,
  LogOut,
  X,
  Phone,
  Inbox,
} from 'lucide-react'

const NAV_ITEMS = [
  { href: '/',                label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/inbox',           label: 'Inbox',          icon: Inbox, badge: true },
  { href: '/jobs',            label: 'Jobs',           icon: Briefcase },
  { href: '/clients',         label: 'Clients',        icon: Users },
  { href: '/communications',  label: 'Communications', icon: Phone },
  { href: '/financials',      label: 'Financials',     icon: DollarSign },
  { href: '/team',            label: 'Team',           icon: HardHat },
  { href: '/supplies',        label: 'Supplies',       icon: ShoppingCart },
  { href: '/tasks',           label: 'Tasks',          icon: CheckSquare },
  { href: '/settings',        label: 'Settings',       icon: Settings },
]

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [inboxCount, setInboxCount] = useState<number>(0)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null)
    })

    // Fetch urgent inbox count
    async function loadInboxCount() {
      try {
        const { count } = await supabase
          .from('inbound_items')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'new')
        setInboxCount(count ?? 0)
      } catch { /* non-critical */ }
    }
    loadInboxCount()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : 'CB'
  const displayName = userEmail ? userEmail.split('@')[0] : 'User'

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 h-full w-[220px] bg-bg-surface border-r border-white/[0.06] flex flex-col z-40',
        'transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[0.06] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group" onClick={onClose}>
          <div className="relative w-8 h-8 rounded-lg bg-brand-green/20 border border-brand-green/30 flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-brand-green" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-brand-green pulse-live" />
          </div>
          <div>
            <div className="text-[13px] font-bold text-text-primary leading-none">Clean Buddies</div>
            <div className="text-[10px] text-text-tertiary mt-0.5 font-medium tracking-wider uppercase">Command Center</div>
          </div>
        </Link>
        {/* Mobile close button */}
        <button
          onClick={onClose}
          className="md:hidden p-1.5 rounded-lg hover:bg-white/[0.05] text-text-tertiary hover:text-text-primary transition-colors"
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon, badge }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
          const showBadge = badge && inboxCount > 0
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group min-h-[44px]',
                isActive
                  ? 'bg-brand-green/10 text-brand-green font-medium'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
              )}
            >
              <Icon
                className={clsx(
                  'w-4 h-4 flex-shrink-0',
                  isActive ? 'text-brand-green' : 'text-text-tertiary group-hover:text-text-secondary'
                )}
              />
              {label}
              {showBadge && !isActive && (
                <span className="ml-auto px-1.5 py-0.5 rounded-full bg-accent-red text-white text-[10px] font-bold min-w-[18px] text-center">
                  {inboxCount > 99 ? '99+' : inboxCount}
                </span>
              )}
              {isActive && (
                <span className="ml-auto w-1 h-4 bg-brand-green rounded-full" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* User section */}
      <div className="px-3 py-4 border-t border-white/[0.06] space-y-1">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-green to-brand-green-dim flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-text-primary truncate capitalize">{displayName}</div>
            <div className="text-[10px] text-text-tertiary truncate">{userEmail ?? '...'}</div>
          </div>
          <div className="w-1.5 h-1.5 rounded-full bg-brand-green flex-shrink-0" />
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-accent-red/5 hover:text-accent-red text-text-tertiary text-xs transition-colors min-h-[44px]"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
