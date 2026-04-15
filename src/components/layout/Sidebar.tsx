'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
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
} from 'lucide-react'

const NAV_ITEMS = [
  { href: '/',           label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/jobs',       label: 'Jobs',       icon: Briefcase },
  { href: '/clients',    label: 'Clients',    icon: Users },
  { href: '/financials', label: 'Financials', icon: DollarSign },
  { href: '/team',       label: 'Team',       icon: HardHat },
  { href: '/supplies',   label: 'Supplies',   icon: ShoppingCart },
  { href: '/tasks',      label: 'Tasks',      icon: CheckSquare },
  { href: '/settings',   label: 'Settings',   icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed left-0 top-0 h-full w-[220px] bg-bg-surface border-r border-white/[0.06] flex flex-col z-40">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[0.06]">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="relative w-8 h-8 rounded-lg bg-brand-green/20 border border-brand-green/30 flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-brand-green" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-brand-green pulse-live" />
          </div>
          <div>
            <div className="text-[13px] font-bold text-text-primary leading-none">Clean Buddies</div>
            <div className="text-[10px] text-text-tertiary mt-0.5 font-medium tracking-wider uppercase">Command Center</div>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 group',
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
              {isActive && (
                <span className="ml-auto w-1 h-4 bg-brand-green rounded-full" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* User section */}
      <div className="px-3 py-4 border-t border-white/[0.06]">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/[0.04] cursor-pointer transition-colors">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-green to-brand-green-dim flex items-center justify-center text-[11px] font-bold text-white">
            C
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-text-primary truncate">Carlo</div>
            <div className="text-[10px] text-text-tertiary">San Diego</div>
          </div>
          <div className="w-1.5 h-1.5 rounded-full bg-brand-green flex-shrink-0" />
        </div>
      </div>
    </aside>
  )
}
