'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { RefreshCw, Bell, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'

const PAGE_TITLES: Record<string, string> = {
  '/':           'Dashboard',
  '/jobs':       'Jobs & Job Costing',
  '/clients':    'Clients & Leads',
  '/financials': 'Financials',
  '/team':       'Team & Crew',
  '/supplies':   'Supply Tracker',
  '/tasks':      'Tasks',
  '/settings':   'Settings',
}

interface HeaderProps {
  lastSynced?: Date | null
  onSync?: () => void
  syncing?: boolean
}

export function Header({ lastSynced, onSync, syncing }: HeaderProps) {
  const pathname = usePathname()
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  const title = PAGE_TITLES[pathname] || PAGE_TITLES[Object.keys(PAGE_TITLES).find(k => k !== '/' && pathname.startsWith(k)) || '/'] || 'Dashboard'

  return (
    <header className="sticky top-0 z-30 h-14 bg-bg-base/80 backdrop-blur-md border-b border-white/[0.06] flex items-center px-6 gap-4">
      <div className="flex-1">
        <h1 className="text-sm font-semibold text-text-primary">{title}</h1>
        <p className="text-[11px] text-text-tertiary font-mono mt-0.5">
          {format(now, 'EEEE, MMM d yyyy')}
        </p>
      </div>

      {/* Sync status */}
      <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-brand-green opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-green" />
        </span>
        {lastSynced
          ? <span className="font-mono">synced {format(lastSynced, 'h:mm a')}</span>
          : <span>live</span>
        }
        {onSync && (
          <button
            onClick={onSync}
            className="ml-1 p-1 rounded hover:bg-white/[0.05] hover:text-text-primary transition-colors"
            title="Sync now"
          >
            <RefreshCw className={clsx('w-3 h-3', syncing && 'animate-spin')} />
          </button>
        )}
      </div>

      {/* Search */}
      <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-surface border border-white/[0.06] text-[12px] text-text-tertiary hover:border-white/10 hover:text-text-secondary transition-all">
        <Search className="w-3 h-3" />
        <span>Search</span>
        <kbd className="ml-2 text-[10px] bg-white/[0.06] px-1.5 py-0.5 rounded">⌘K</kbd>
      </button>

      {/* Notifications */}
      <button className="relative p-2 rounded-lg hover:bg-white/[0.05] text-text-secondary hover:text-text-primary transition-colors">
        <Bell className="w-4 h-4" />
        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent-red" />
      </button>
    </header>
  )
}
