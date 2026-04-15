'use client'
import { clsx } from 'clsx'

interface SkeletonProps {
  className?: string
  lines?: number
}

export function Skeleton({ className, lines = 1 }: SkeletonProps) {
  if (lines > 1) {
    return (
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={clsx(
              'animate-pulse rounded bg-white/5',
              i === lines - 1 && 'w-3/4',
              className || 'h-4'
            )}
          />
        ))}
      </div>
    )
  }
  return (
    <div className={clsx('animate-pulse rounded bg-white/5', className || 'h-4 w-full')} />
  )
}
