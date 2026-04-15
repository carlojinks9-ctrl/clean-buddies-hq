'use client'
import { clsx } from 'clsx'
import { marginColor, formatMargin } from '@/lib/margin'

interface MarginBadgeProps {
  margin: number
  className?: string
}

export function MarginBadge({ margin, className }: MarginBadgeProps) {
  const color = marginColor(margin)
  return (
    <span
      className={clsx(
        'inline-flex items-center font-mono text-[11px] font-semibold px-2 py-0.5 rounded',
        {
          'bg-brand-green/15 text-brand-green': color === 'green',
          'bg-accent-amber/15 text-accent-amber': color === 'amber',
          'bg-accent-red/15 text-accent-red': color === 'red',
        },
        className
      )}
    >
      {formatMargin(margin)}
    </span>
  )
}
