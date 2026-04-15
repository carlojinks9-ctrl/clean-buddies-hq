'use client'
import { clsx } from 'clsx'

type StatusType = 'active' | 'scheduled' | 'completed' | 'invoiced' | 'issue' | 'online' | 'offline'

interface StatusDotProps {
  status: StatusType
  pulse?: boolean
  size?: 'sm' | 'md'
  label?: string
}

const statusColors: Record<StatusType, string> = {
  active:    'bg-brand-green',
  scheduled: 'bg-accent-amber',
  completed: 'bg-accent-blue',
  invoiced:  'bg-purple-400',
  issue:     'bg-accent-red',
  online:    'bg-brand-green',
  offline:   'bg-text-tertiary',
}

export function StatusDot({ status, pulse, size = 'md', label }: StatusDotProps) {
  const dotClass = clsx(
    'rounded-full flex-shrink-0',
    statusColors[status],
    size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2',
    pulse && 'animate-pulse'
  )

  if (label) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={dotClass} />
        <span className="text-xs text-text-secondary capitalize">{label || status}</span>
      </span>
    )
  }

  return <span className={dotClass} />
}
