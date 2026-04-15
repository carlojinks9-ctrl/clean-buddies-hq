import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { MonoValue } from '@/components/ui/MonoValue'
import { StatusDot } from '@/components/ui/StatusDot'
import { MarginBadge } from '@/components/ui/MarginBadge'
import { ArrowLeft, Mail, Phone, Building2, Briefcase } from 'lucide-react'
import { format } from 'date-fns'
import type { Client, Job } from '@/types'

async function getClient(id: string) {
  try {
    const db = createServerClient()
    const [clientRes, jobsRes] = await Promise.all([
      db.from('clients').select('*').eq('id', id).single(),
      db.from('jobs').select('*').eq('client_id', id).order('created_at', { ascending: false }),
    ])
    if (!clientRes.data) return null
    return {
      client: clientRes.data as Client,
      jobs: (jobsRes.data || []) as Job[],
    }
  } catch {
    return null
  }
}

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const result = await getClient(params.id)
  if (!result) notFound()
  const { client, jobs } = result

  const totalRevenue = jobs.reduce((s, j) => s + j.contract_value_cents, 0)
  const completedJobs = jobs.filter(j => ['completed', 'invoiced'].includes(j.status))

  return (
    <div className="space-y-5 max-w-4xl">
      <Link href="/clients" className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors">
        <ArrowLeft className="w-3 h-3" />
        Back to Clients
      </Link>

      <div className="card p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center text-lg font-bold text-text-primary">
              {(client.company_name || client.name).charAt(0)}
            </div>
            <div>
              <h1 className="text-xl font-bold">{client.company_name || client.name}</h1>
              {client.company_name && <p className="text-sm text-text-secondary">{client.name}</p>}
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={client.is_gc ? 'amber' : 'gray'} dot>
                  {client.is_gc ? 'General Contractor' : 'Residential'}
                </Badge>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-text-tertiary mb-1">Total Revenue</p>
            <MonoValue cents={totalRevenue} size="xl" />
            <p className="text-[11px] text-text-tertiary mt-0.5">{jobs.length} jobs</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-5">
          {client.email && (
            <div className="flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 text-text-tertiary" />
              <a href={`mailto:${client.email}`} className="text-sm text-text-secondary hover:text-brand-green transition-colors">
                {client.email}
              </a>
            </div>
          )}
          {client.phone && (
            <div className="flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-text-tertiary" />
              <a href={`tel:${client.phone}`} className="text-sm text-text-secondary hover:text-brand-green transition-colors">
                {client.phone}
              </a>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5 text-text-tertiary" />
            <span className="text-sm text-text-secondary">
              Since {format(new Date(client.created_at), 'MMM yyyy')}
            </span>
          </div>
        </div>

        {client.notes && (
          <div className="mt-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <p className="text-xs text-text-secondary">{client.notes}</p>
          </div>
        )}
      </div>

      {/* Job History */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-text-tertiary" />
            <CardTitle>Job History</CardTitle>
          </div>
          <span className="text-[11px] text-text-tertiary">{completedJobs.length} completed</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th className="text-right">Contract</th>
                <th className="text-right">Margin</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-6 text-xs text-text-tertiary">No jobs yet</td></tr>
              ) : jobs.map(job => (
                <tr key={job.id}>
                  <td>
                    <Link href={`/jobs/${job.id}`} className="font-medium hover:text-brand-green transition-colors">
                      {job.title}
                    </Link>
                    <p className="text-[11px] text-text-tertiary">{job.job_number}</p>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={job.status as any} />
                      <span className="text-xs text-text-secondary capitalize">{job.status}</span>
                    </div>
                  </td>
                  <td className="text-right"><MonoValue cents={job.contract_value_cents} size="sm" /></td>
                  <td className="text-right"><MarginBadge margin={job.gross_margin} /></td>
                  <td>
                    <span className="text-[11px] text-text-tertiary font-mono">
                      {job.start_date ? format(new Date(job.start_date), 'MMM d, yyyy') : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
