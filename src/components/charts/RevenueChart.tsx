'use client'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

const DATA = [
  { month: 'Oct', revenue: 68000, target: 75000 },
  { month: 'Nov', revenue: 72500, target: 75000 },
  { month: 'Dec', revenue: 59000, target: 75000 },
  { month: 'Jan', revenue: 81000, target: 80000 },
  { month: 'Feb', revenue: 93500, target: 85000 },
  { month: 'Mar', revenue: 110200, target: 90000 },
  { month: 'Apr', revenue: 124700, target: 100000 },
]

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 shadow-xl">
        <p className="text-[11px] text-text-tertiary mb-1">{label}</p>
        {payload.map((p: any) => (
          <div key={p.name} className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
            <span className="text-xs font-mono text-text-primary">
              ${(p.value / 1000).toFixed(1)}k
            </span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

export function RevenueChart() {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={DATA} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1D9E75" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#1D9E75" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="targetGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#378ADD" stopOpacity={0.1} />
            <stop offset="100%" stopColor="#378ADD" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 10, fill: '#55555F' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#55555F', fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={v => `$${v / 1000}k`}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="target"
          stroke="#378ADD"
          strokeWidth={1}
          strokeDasharray="4 2"
          fill="url(#targetGrad)"
          dot={false}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#1D9E75"
          strokeWidth={2}
          fill="url(#revenueGrad)"
          dot={false}
          activeDot={{ r: 4, fill: '#1D9E75', strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
