/**
 * Contact resolution: normalize phone numbers and resolve them against
 * known contacts (quo_contacts, leads, clients) so we can show real
 * names instead of raw numbers across inbox + communications.
 */

/** Last 10 digits for strict matching */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10)
}

/** Last 7 digits for looser matching (handles local numbers) */
export function phoneKey(phone: string): string {
  return phone.replace(/\D/g, '').slice(-7)
}

/** Format a raw number for display */
export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').slice(-10)
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return phone
}

export interface ResolvedContact {
  name: string
  /** What we know about this contact */
  type: 'client' | 'lead' | 'contact' | 'employee' | 'unknown'
  /** Short human-readable context string */
  context: string | null
  /** DB id */
  id: string | null
}

/** phone7 → ResolvedContact */
export type ContactMap = Record<string, ResolvedContact>

export function buildContactMap(
  quoContacts: Array<{ id: string; name: string; phone: string; company?: string | null }>,
  leads: Array<{ id: string; name: string; phone?: string | null; status?: string }>,
  clients: Array<{ id: string; name?: string | null; company_name?: string | null; phone?: string | null }>,
  employees: Array<{ id: string; name: string; phone?: string | null }>,
): ContactMap {
  const map: ContactMap = {}

  const set = (phone: string | null | undefined, entry: ResolvedContact) => {
    if (!phone) return
    const key = phoneKey(phone)
    if (key.length < 7) return
    if (!map[key]) map[key] = entry  // first write wins — set priority below
  }

  // Priority lowest → highest (each overrides previous for same key)
  employees.forEach(e =>
    set(e.phone, { name: e.name, type: 'employee', context: 'team member', id: e.id })
  )
  quoContacts.forEach(c =>
    set(c.phone, { name: c.name, type: 'contact', context: c.company ?? null, id: c.id })
  )
  leads.forEach(l =>
    set(l.phone, { name: l.name, type: 'lead', context: `${l.status ?? 'active'} lead`, id: l.id })
  )
  clients.forEach(c => {
    const name = c.company_name ?? c.name ?? 'Client'
    set(c.phone, { name, type: 'client', context: 'existing client', id: c.id })
  })

  return map
}

export function resolvePhone(
  phone: string | null | undefined,
  map: ContactMap,
): ResolvedContact | null {
  if (!phone) return null
  return map[phoneKey(phone)] ?? null
}

/**
 * Get the best display name for a contact.
 * Falls back: resolved map > rawName (if not a raw number) > formatted phone > 'Unknown'
 */
export function getDisplayInfo(
  rawName: string | null,
  phone: string | null | undefined,
  map: ContactMap,
): { name: string; resolved: ResolvedContact | null } {
  const resolved = resolvePhone(phone, map)
  if (resolved) return { name: resolved.name, resolved }
  // rawName is useful only if it's not just the phone number itself
  if (rawName && phone && rawName !== phone && rawName !== formatPhone(phone)) {
    return { name: rawName, resolved: null }
  }
  if (rawName && !phone) return { name: rawName, resolved: null }
  if (phone) return { name: formatPhone(phone), resolved: null }
  return { name: 'Unknown', resolved: null }
}

/** Badge color + label for contact type */
export const CONTACT_TYPE_STYLE: Record<ResolvedContact['type'], { color: string; label: string }> = {
  client:   { color: 'text-brand-blue bg-brand-blue/10',   label: 'Client' },
  lead:     { color: 'text-brand-green bg-brand-green/10', label: 'Lead' },
  contact:  { color: 'text-text-secondary bg-bg-elevated', label: 'Contact' },
  employee: { color: 'text-accent-amber bg-accent-amber/10', label: 'Team' },
  unknown:  { color: 'text-text-tertiary bg-bg-elevated',  label: '?' },
}
