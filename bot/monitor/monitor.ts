import type { SupabaseClient } from '@supabase/supabase-js'

const FLAG_PATTERNS: Record<string, { severity: 'high' | 'medium' | 'low'; keywords: string[] }> = {
  safety: {
    severity: 'high',
    keywords: ['hurt', 'injury', 'injured', 'accident', 'hospital', 'unsafe', 'hazard', 'emergency', 'help me'],
  },
  vehicle: {
    severity: 'high',
    keywords: ['flat tire', 'breakdown', 'car accident', 'truck broke', 'van broke'],
  },
  schedule: {
    severity: 'medium',
    keywords: ["can't make it", "cant make it", 'running late', 'no show', 'sick', 'call out', 'calling out'],
  },
  equipment: {
    severity: 'medium',
    keywords: ['broken', 'out of', 'ran out', 'need supplies', 'equipment broke', 'machine broke', 'vacuum broke'],
  },
  customer: {
    severity: 'medium',
    keywords: ['client complaint', 'customer complaint', 'unhappy', 'not happy', 'problem with client'],
  },
  supply: {
    severity: 'low',
    keywords: ['need more', 'running low', 'order more', 'out of supplies'],
  },
  urgency: {
    severity: 'medium',
    keywords: ['asap', 'urgent', 'immediately'],
  },
}

export interface FlagResult {
  category: string
  severity: 'high' | 'medium' | 'low'
  senderName: string
}

export async function monitorMessage(
  text: string,
  senderName: string,
  _db: SupabaseClient
): Promise<FlagResult | null> {
  const lower = text.toLowerCase()

  for (const [category, { severity, keywords }] of Object.entries(FLAG_PATTERNS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return { category, severity, senderName }
    }
  }

  return null
}
