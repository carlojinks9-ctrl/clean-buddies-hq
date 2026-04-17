'use client'
import { ReactNode } from 'react'
import { clsx } from 'clsx'

interface CardProps {
  children: ReactNode
  className?: string
  hoverable?: boolean
  onClick?: () => void
  id?: string
}

export function Card({ children, className, hoverable, onClick, id }: CardProps) {
  return (
    <div
      id={id}
      onClick={onClick}
      className={clsx(
        'card',
        hoverable && 'cursor-pointer hover:border-white/10 hover:bg-bg-elevated transition-all duration-150',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex items-center justify-between px-4 py-3 border-b border-white/[0.06]', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx('text-sm font-semibold text-text-primary tracking-tight', className)}>
      {children}
    </span>
  )
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('p-4', className)}>{children}</div>
}
