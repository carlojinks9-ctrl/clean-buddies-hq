import { NextResponse } from 'next/server'
import { executeTool, AGENT_TOOL_DEFINITIONS, type AgentAction } from '@/lib/agent-tools'
import { format } from 'date-fns'

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const today = format(new Date(), 'EEEE, MMMM d, yyyy')
  return `You are the CB Agent — the intelligence operator for Clean Buddies LLC, a post-construction and luxury residential cleaning company in the Greater Phoenix metro area.

Today: ${today}

THE TEAM:
- Carlo (San Diego): Sales, strategy, systems, client relationships, invoicing, biz dev
- Jorden (Phoenix): Field ops, crew management, walkthroughs, on-site execution

YOUR JOB:
You help run the business by answering: what matters right now, what's falling through the cracks, what needs to happen next. You read real data from the system, create real work items, and draft real responses. You are an ops coordinator, not a summary machine.

BUSINESS NUMBERS:
- Burdened labor rate: $23.10/hr
- Target gross margin: 65% | Absolute floor: 50%
- Pricing formula: Price = Cost ÷ (1 − target margin%)
- NEVER use markup-based calculations

KEY GC CLIENTS:
Chord Construction, Black Stone Development, Blandford Homes, ValWest, Luxury Remodels, Design Build Custom Homes

CREW:
Stacy McAllister ($21.50/hr), Johao Cortez ($22.05/hr), David Stafinski ($20/hr), Jesus Sanchez ($20.40/hr), Santa Galaviz ($21.50/hr), Rosemarie Mesa ($20.40/hr)

OPERATING RULES:
1. Always use tools to get real data before making claims about numbers or status
2. Lead with the most important thing — do not bury the lede
3. When you find a problem, also state the fix
4. After creating a task or updating a lead, confirm exactly what you did and why
5. When drafting replies, label them **[DRAFT — NOT SENT]** and note the channel (SMS, email)
6. Be direct. No filler phrases. No "Great question!" No "Certainly!"
7. Format with markdown: bold for emphasis, bullets for lists, keep it scannable

SAFE TO DO WITHOUT ASKING:
- Create tasks (always confirm after)
- Update task status, priority, assignee, due date
- Create lead records
- Update lead urgency, owner, next action, status (new → contacted → bid_sent)
- Draft reply text (text only, never auto-sends)

DO NOT DO WITHOUT EXPLICIT INSTRUCTION:
- Mark a lead as won or lost
- Any financial record changes
- Mark something as invoiced/paid
- Any outbound customer communication (only draft)

RESPONSE FORMAT:
Use markdown. Bold key numbers and names. Bullet lists for multiple items. Keep it tight — these are busy operators reading on a dashboard.

When you take an action (create task, update lead), end that section with:
✅ [Task/Lead] created: "Title" (priority, assignee)

When drafting a reply, format it clearly:
**[DRAFT — SMS reply to [Name]]**
---
[message text]
---
Not sent. Copy and paste into Quo to send.`
}

// ─── Anthropic API message types ──────────────────────────────────────────────

interface TextBlock {
  type: 'text'
  text: string
}
interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
}

type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

interface ApiMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured. Add it in Vercel Environment Variables.' },
      { status: 500 }
    )
  }

  let body: { messages: ApiMessage[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { messages } = body
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages array required' }, { status: 400 })
  }

  // Agentic loop — up to 6 rounds of tool calls
  let currentMessages: ApiMessage[] = messages
  const actionsTaken: AgentAction[] = []
  const MAX_ROUNDS = 6

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let anthropicRes: Response
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: buildSystemPrompt(),
          tools: AGENT_TOOL_DEFINITIONS,
          messages: currentMessages,
        }),
      })
    } catch (err) {
      console.error('[agent/chat] Network error calling Anthropic:', err)
      return NextResponse.json(
        { error: 'Failed to reach Anthropic API. Check your network connection.' },
        { status: 502 }
      )
    }

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => '')
      console.error('[agent/chat] Anthropic error:', anthropicRes.status, errText)
      return NextResponse.json(
        { error: `Anthropic API error ${anthropicRes.status}: ${errText.slice(0, 200)}` },
        { status: 502 }
      )
    }

    const data = await anthropicRes.json()
    const content: ContentBlock[] = data.content || []
    const stopReason: string = data.stop_reason || 'end_turn'

    // Finished — return text response
    if (stopReason === 'end_turn') {
      const textBlock = content.find((c): c is TextBlock => c.type === 'text')
      return NextResponse.json({
        reply: textBlock?.text ?? '',
        actions_taken: actionsTaken,
      })
    }

    // Tool calls requested
    if (stopReason === 'tool_use') {
      const toolUseBlocks = content.filter((c): c is ToolUseBlock => c.type === 'tool_use')
      const toolResults: ToolResultBlock[] = []

      for (const toolUse of toolUseBlocks) {
        console.log(`[agent/chat] Round ${round + 1}: calling tool "${toolUse.name}"`)
        try {
          const { result, action } = await executeTool(toolUse.name, toolUse.input)
          if (action) actionsTaken.push(action)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          })
        } catch (err) {
          console.error(`[agent/chat] Tool "${toolUse.name}" threw:`, err)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: String(err) }),
          })
        }
      }

      // Extend history with assistant content + tool results
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content },
        { role: 'user', content: toolResults },
      ]
      continue
    }

    // Unexpected stop reason
    const textBlock = content.find((c): c is TextBlock => c.type === 'text')
    return NextResponse.json({
      reply: textBlock?.text ?? `Stopped with reason: ${stopReason}`,
      actions_taken: actionsTaken,
    })
  }

  return NextResponse.json({
    reply:
      "I've reached my analysis limit for this query. Try breaking it into smaller questions.",
    actions_taken: actionsTaken,
  })
}
