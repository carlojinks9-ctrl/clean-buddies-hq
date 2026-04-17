'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, CheckCheck, ExternalLink, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface DBNotification {
  id: string
  type: string
  title: string
  message: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  recipient: 'carlo' | 'jorden' | 'both' | null
  is_read: boolean
  link_to: string | null
  created_at: string
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-accent-red',
  high: 'bg-accent-amber',
  medium: 'bg-accent-blue',
  low: 'bg-text-tertiary',
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<DBNotification[]>([])
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const unreadCount = notifications.filter(n => !n.is_read).length

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('is_dismissed', false)
      .order('created_at', { ascending: false })
      .limit(30)
    setNotifications((data ?? []) as DBNotification[])
    setLoading(false)
  }, [])

  // Initial load + auto-refresh every 30s
  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [load])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function markRead(id: string) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
  }

  async function markAllRead() {
    const ids = notifications.filter(n => !n.is_read).map(n => n.id)
    if (ids.length === 0) return
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    await supabase.from('notifications').update({ is_read: true }).in('id', ids)
  }

  async function dismiss(id: string) {
    setNotifications(prev => prev.filter(n => n.id !== id))
    await supabase.from('notifications').update({ is_dismissed: true }).eq('id', id)
  }

  async function handleNotificationClick(n: DBNotification) {
    await markRead(n.id)
    if (n.link_to) {
      window.location.href = n.link_to
    }
    setOpen(false)
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => { setOpen(p => !p); if (!open) load() }}
        className="relative p-2 rounded-lg hover:bg-white/[0.05] text-text-secondary hover:text-text-primary transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ''}`}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-accent-red text-[10px] text-white font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[360px] max-w-[calc(100vw-2rem)] z-50 rounded-xl border border-white/[0.08] bg-bg-surface shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <span className="text-sm font-semibold text-text-primary">Notifications</span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-brand-green transition-colors"
                >
                  <CheckCheck className="w-3 h-3" />
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-white/[0.06] text-text-tertiary hover:text-text-primary transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto overscroll-contain divide-y divide-white/[0.04]">
            {loading && notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-text-tertiary">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="w-6 h-6 text-text-tertiary mx-auto mb-2 opacity-40" />
                <p className="text-sm text-text-secondary">No notifications</p>
                <p className="text-xs text-text-tertiary mt-0.5">You're all caught up</p>
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={clsx(
                    'group relative flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer',
                    !n.is_read ? 'bg-white/[0.025] hover:bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                  )}
                  onClick={() => handleNotificationClick(n)}
                >
                  {/* Priority dot */}
                  <div className="flex-shrink-0 mt-1.5">
                    <span className={clsx('block w-2 h-2 rounded-full', PRIORITY_DOT[n.priority])} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pr-6">
                    <div className="flex items-center gap-1.5">
                      <p className={clsx(
                        'text-sm truncate',
                        n.is_read ? 'text-text-secondary' : 'text-text-primary font-medium'
                      )}>
                        {n.title}
                      </p>
                      {n.link_to && (
                        <ExternalLink className="w-2.5 h-2.5 text-text-tertiary flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                    {n.message && (
                      <p className="text-xs text-text-tertiary mt-0.5 line-clamp-2 leading-relaxed">{n.message}</p>
                    )}
                    <p className="text-[10px] text-text-tertiary font-mono mt-1">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>

                  {/* Dismiss */}
                  <button
                    onClick={(e) => { e.stopPropagation(); dismiss(n.id) }}
                    className="absolute right-3 top-3 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/[0.08] text-text-tertiary hover:text-text-primary transition-all"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-white/[0.06] text-center">
              <a href="/settings#notifications" className="text-[11px] text-text-tertiary hover:text-accent-blue transition-colors">
                Notification settings
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
