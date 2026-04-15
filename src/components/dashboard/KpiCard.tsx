'use client'
import { ReactNode } from 'react'
import { clsx } from 'clsx'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface KpiCardProps {
  title: string
  value: string
  subvalue?: string
  change?: number      // % change vs prior period
  icon: ReactNode
  iconColor?: string
  mono?: boolean
  children?: ReactNode
}

export function KpiCard({ title, value, subvalue, change, icon, iconColor, mono, children }: KpiCardProps) {
  const changePositive = change !== undefined && change > 0
  const changeNegative = change !== undefined && change < 0
  const changeFlat = change === 0

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center', iconColor || 'bg-white/5')}>
          {icon}
        </div>
        {change !== undefined && (
          <div className={clsx(
            'flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md',
            changePositive && 'bg-brand-green/10 text-brand-green',
            changeNegative && 'bg-accent-red/10 text-accent-red',
            changeFlat && 'bg-white/5 text-text-secondary',
          )}>
            {changePositive && <TrendingUp className="w-3 h-3" />}
            {changeNegative && <TrendingDown className="w-3 h-3" />}
            {changeFlat && <Minus className="w-3 h-3" />}
            <span className="font-mono">{change > 0 ? '+' : ''}{change?.toFixed(1)}%</span>
          </div>
        )}
      </div>

      <div>
        <p className="text-[11px] text-text-tertiary font-medium uppercase tracking-wider">{title}</p>
        <p className={clsx('text-2xl font-bold text-text-primary mt-1', mono && 'font-mono')}>
          {value}
        </p>
        {subvalue && <p className="text-xs text-text-secondary mt-0.5 font-mono">{subvalue}</p>}
      </div>

      {children}
    </div>
  )
}
