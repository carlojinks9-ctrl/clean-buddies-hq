'use client'
import { ReactNode } from 'react'
import { clsx } from 'clsx'

type BadgeVariant = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'purple'

interface BadgeProps {
  variant?: BadgeVariant
  children: ReactNode
  className?: string
  dot?: boolean
}

const variantStyles: Record<BadgeVariant, string> = {
  green:  'bg-brand-green/15 text-brand-green border border-brand-green/20',
  amber:  'bg-accent-amber/15 text-accent-amber border border-accent-amber/20',
  red:    'bg-accent-red/15 text-accent-red border border-accent-red/20',
  blue:   'bg-accent-blue/15 text-accent-blue border border-accent-blue/20',
  gray:   'bg-white/5 text-text-secondary border border-white/10',
  purple: 'bg-purple-500/15 text-purple-400 border border-purple-500/20',
}

export function Badge({ variant = 'gray', children, className, dot }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium',
        variantStyles[variant],
        className
      )}
    >
      {dot && (
        <span className={clsx('w-1.5 h-1.5 rounded-full', {
          'bg-brand-green': variant === 'green',
          'bg-accent-amber': variant === 'amber',
          'bg-accent-red': variant === 'red',
          'bg-accent-blue': variant === 'blue',
          'bg-text-secondary': variant === 'gray',
          'bg-purple-400': variant === 'purple',
        })} />
      )}
      {children}
    </span>
  )
}
