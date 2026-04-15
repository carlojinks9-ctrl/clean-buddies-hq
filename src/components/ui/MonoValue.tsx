'use client'
import { ReactNode } from 'react'
import { clsx } from 'clsx'
import { formatCents } from '@/lib/margin'

interface MonoValueProps {
  children?: ReactNode
  cents?: number
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  showCents?: boolean
  color?: string
}

const sizes: Record<string, string> = {
  sm:  'text-xs',
  md:  'text-sm',
  lg:  'text-base',
  xl:  'text-xl',
  '2xl': 'text-2xl',
}

export function MonoValue({ children, cents, className, size = 'md', showCents, color }: MonoValueProps) {
  const value = cents !== undefined ? formatCents(cents, { showCents }) : children
  return (
    <span
      className={clsx(
        'font-mono tabular-nums font-medium',
        sizes[size] || sizes.md,
        color || 'text-text-primary',
        className
      )}
    >
      {value}
    </span>
  )
}
