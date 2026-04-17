import { createServerClient } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { MonoValue } from '@/components/ui/MonoValue'
import { HardHat, Car, CheckCircle, XCircle, DollarSign } from 'lucide-react'
import { format } from 'date-fns'
import type { Employee } from '@/types'

async function getEmployees() {
  try {
    const db = createServerClient()
    const { data } = await db.from('employees').select('*').order('name')
    return (data || []) as Employee[]
  } catch {
    return []
  }
}

export default async function TeamPage() {
  const employees = await getEmployees()

  const active = employees.filter(e => e.status === 'active')
  const totalBurdenedPerHour = active.reduce((s, e) => s + e.burdened_rate_cents, 0)
  const avgBurdenedRate = active.length > 0 ? totalBurdenedPerHour / active.length : 0

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Active Team Members</p>
          <p className="text-2xl font-bold font-mono">{active.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Avg Burdened Rate</p>
          <p className="text-2xl font-bold font-mono text-accent-amber">
            ${(avgBurdenedRate / 100).toFixed(2)}/hr
          </p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Qualified Drivers</p>
          <p className="text-2xl font-bold font-mono">{active.filter(e => e.is_driver).length}</p>
        </div>
      </div>

      {/* Employee roster */}
      <Card>
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
          <HardHat className="w-4 h-4 text-text-tertiary" />
          <h2 className="text-sm font-semibold">Team Roster</h2>
        </div>
        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-white/[0.04]">
          {employees.map(emp => (
            <div key={emp.id} className="p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-[11px] font-bold text-text-primary flex-shrink-0">
                    {emp.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-medium text-text-primary">{emp.name}</p>
                    <p className="text-[11px] text-text-tertiary capitalize">{emp.role}</p>
                  </div>
                </div>
                <Badge variant={emp.status === 'active' ? 'green' : emp.status === 'on_leave' ? 'amber' : 'gray'} dot>
                  {emp.status === 'on_leave' ? 'On Leave' : emp.status}
                </Badge>
              </div>
              <div className="flex items-center gap-4 flex-wrap text-sm">
                <div>
                  <p className="text-[10px] text-text-tertiary">Base</p>
                  <span className="font-mono text-text-secondary">${(emp.base_rate_cents / 100).toFixed(2)}/hr</span>
                </div>
                <div>
                  <p className="text-[10px] text-text-tertiary">Burdened</p>
                  <span className="font-mono text-accent-amber">${(emp.burdened_rate_cents / 100).toFixed(2)}/hr</span>
                </div>
                {emp.is_driver && (
                  <span className="flex items-center gap-1 text-brand-green text-xs">
                    <Car className="w-3 h-3" /> Driver
                  </span>
                )}
                {emp.hire_date && (
                  <span className="text-[11px] text-text-tertiary font-mono ml-auto">
                    {format(new Date(emp.hire_date), 'MMM d, yyyy')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th className="text-right">Base Rate</th>
                <th className="text-right">Burdened Rate</th>
                <th>Driver</th>
                <th>Status</th>
                <th>Hire Date</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-[11px] font-bold text-text-primary flex-shrink-0">
                        {emp.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-text-primary">{emp.name}</p>
                        {emp.email && <p className="text-[11px] text-text-tertiary">{emp.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="text-sm text-text-secondary capitalize">{emp.role}</span>
                  </td>
                  <td className="text-right">
                    <span className="font-mono text-sm text-text-secondary">
                      ${(emp.base_rate_cents / 100).toFixed(2)}/hr
                    </span>
                  </td>
                  <td className="text-right">
                    <span className="font-mono text-sm text-accent-amber">
                      ${(emp.burdened_rate_cents / 100).toFixed(2)}/hr
                    </span>
                  </td>
                  <td>
                    {emp.is_driver ? (
                      <span className="flex items-center gap-1 text-brand-green text-xs">
                        <Car className="w-3.5 h-3.5" />
                        <CheckCircle className="w-3 h-3" />
                      </span>
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-text-tertiary" />
                    )}
                  </td>
                  <td>
                    <Badge
                      variant={emp.status === 'active' ? 'green' : emp.status === 'on_leave' ? 'amber' : 'gray'}
                      dot
                    >
                      {emp.status === 'on_leave' ? 'On Leave' : emp.status}
                    </Badge>
                  </td>
                  <td>
                    <span className="text-[11px] text-text-tertiary font-mono">
                      {emp.hire_date ? format(new Date(emp.hire_date), 'MMM d, yyyy') : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Rates breakdown */}
      <Card>
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-sm font-semibold">Labor Cost Breakdown</h2>
          <p className="text-[11px] text-text-tertiary mt-0.5">Burdened rate = base × 1.10 employer cost multiplier (SS, Medicare, FUTA, AZ SUI)</p>
        </div>
        <div className="p-4 space-y-2">
          {active.map(emp => {
            const burden = emp.burdened_rate_cents - emp.base_rate_cents
            return (
              <div key={emp.id} className="flex items-center gap-3">
                <span className="w-32 text-sm text-text-secondary truncate">{emp.name.split(' ')[0]}</span>
                <div className="flex-1 relative h-5 bg-bg-elevated rounded-full overflow-hidden">
                  <div
                    className="absolute left-0 top-0 h-full bg-brand-green/30 rounded-full"
                    style={{ width: `${(emp.base_rate_cents / 2500) * 100}%` }}
                  />
                  <div
                    className="absolute top-0 h-full bg-accent-amber/30 rounded-full"
                    style={{
                      left: `${(emp.base_rate_cents / 2500) * 100}%`,
                      width: `${(burden / 2500) * 100}%`
                    }}
                  />
                </div>
                <span className="font-mono text-xs text-accent-amber w-20 text-right">
                  ${(emp.burdened_rate_cents / 100).toFixed(2)}/hr
                </span>
              </div>
            )
          })}
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/[0.06]">
            <span className="flex items-center gap-1 text-[10px] text-text-tertiary">
              <span className="w-3 h-1.5 bg-brand-green/30 rounded inline-block" /> Base pay
            </span>
            <span className="flex items-center gap-1 text-[10px] text-text-tertiary">
              <span className="w-3 h-1.5 bg-accent-amber/30 rounded inline-block" /> Employer burden (~10%)
            </span>
          </div>
        </div>
      </Card>
    </div>
  )
}
