/**
 * AI-powered communication flagging using Claude (claude-haiku-4-5-20251001).
 * Analyzes call summaries / message bodies and flags items that need attention.
 * Requires ANTHROPIC_API_KEY in env.
 */

export interface FlagResult {
  is_flagged: boolean
  flag_reason: string | null
  tags: string[]
}

const SYSTEM_PROMPT = `You are an analyst for Clean Buddies LLC, a post-construction and luxury residential cleaning company in the Greater Phoenix metro area. Your job is to analyze business communications (calls and text messages) and identify ones that need immediate management attention.

FLAG communications that contain:
- New potential leads (someone asking about cleaning services, pricing, availability, scheduling a job)
- Complaints or dissatisfied customers
- Scheduling conflicts, cancellations, or change requests
- Payment or billing questions / disputes
- Urgent or time-sensitive requests
- Situations clearly needing follow-up
- Competitor mentions or price shopping
- Unknown callers who sound like qualified prospects

Do NOT flag: internal team chatter, routine confirmations, already-resolved matters, spam, wrong numbers.

Return concise, actionable flag reasons (e.g., "New lead — asking about post-construction pricing" or "Complaint — unhappy with last clean").`

export async function analyzeAndFlag(content: string): Promise<FlagResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[ai-flag] ANTHROPIC_API_KEY not set — skipping AI analysis')
    return { is_flagged: false, flag_reason: null, tags: [] }
  }

  const trimmed = content?.trim() ?? ''
  if (trimmed.length < 10) {
    return { is_flagged: false, flag_reason: null, tags: [] }
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Analyze this communication and respond with valid JSON only — no markdown, no explanation:

"${trimmed.slice(0, 1500)}"

Respond exactly in this format:
{"is_flagged":boolean,"flag_reason":"brief actionable reason, or null if not flagged","tags":["tag1","tag2"]}

Valid tags: lead, complaint, scheduling, billing, urgent, follow-up, pricing, new-client, unhappy, positive, missed-opportunity, unknown-caller`,
          },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      console.error('[ai-flag] Anthropic API error:', res.status, err)
      return { is_flagged: false, flag_reason: null, tags: [] }
    }

    const data = await res.json()
    const text = (data.content?.[0]?.text ?? '').trim()

    const parsed = JSON.parse(text)
    return {
      is_flagged: Boolean(parsed.is_flagged),
      flag_reason: typeof parsed.flag_reason === 'string' && parsed.flag_reason ? parsed.flag_reason : null,
      tags: Array.isArray(parsed.tags) ? (parsed.tags as string[]).slice(0, 8) : [],
    }
  } catch (err) {
    console.error('[ai-flag] Failed to analyze:', err)
    return { is_flagged: false, flag_reason: null, tags: [] }
  }
}

/** Batch-analyze multiple items. Returns same-order results array. */
export async function batchAnalyzeAndFlag(contents: string[]): Promise<FlagResult[]> {
  // Run concurrently but limit to 3 at a time to avoid rate limits
  const results: FlagResult[] = new Array(contents.length)
  const CONCURRENCY = 3

  for (let i = 0; i < contents.length; i += CONCURRENCY) {
    const batch = contents.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(batch.map(c => analyzeAndFlag(c)))
    batchResults.forEach((r, j) => { results[i + j] = r })
  }

  return results
}
