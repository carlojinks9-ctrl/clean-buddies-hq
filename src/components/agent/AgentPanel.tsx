'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Send, Zap, RefreshCw, CheckCircle2, UserPlus, ChevronDown, ChevronUp } from 'lucide-react'
import type { AgentAction } from '@/lib/agent-tools'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  actions?: AgentAction[]
  error?: boolean
}

interface ApiMessage {
  role: 'user' | 'assistant'
  content: string
}

// ─── Quick action presets ─────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'What needs attention?', prompt: "What needs attention right now? Give me a prioritized ops snapshot." },
  { label: 'Triage inbox', prompt: "Triage my inbox. What came in, how urgent is it, and what should happen with each item?" },
  { label: 'Stale follow-ups', prompt: "Which leads have stale or overdue follow-ups? Identify the most important ones and suggest next steps." },
  { label: 'Jobs to invoice', prompt: "Which completed jobs haven't been invoiced yet? List them and estimate the outstanding value." },
  { label: 'Open tasks', prompt: "What are the open tasks right now? Group by urgency and flag anything overdue." },
  { label: 'Supply issues', prompt: "Are there any pending supply requests? What's needed, who asked, and for which job?" },
] as const

// ─── Simple markdown renderer ─────────────────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let key = 0

  const renderInline = (line: string): React.ReactNode => {
    // Handle bold **text** and __text__
    const parts = line.split(/(\*\*[^*]+\*\*|__[^_]+__)/g)
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-semibold text-text-primary">{part.slice(2, -2)}</strong>
      }
      if (part.startsWith('__') && part.endsWith('__')) {
        return <strong key={i} className="font-semibold text-text-primary">{part.slice(2, -2)}</strong>
      }
      // Handle inline code `code`
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="px-1 rounded bg-white/10 font-mono text-[11px] text-accent-blue">{part.slice(1, -1)}</code>
      }
      return part
    })
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '') {
      nodes.push(<div key={key++} className="h-2" />)
      i++
      continue
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      nodes.push(
        <p key={key++} className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider mt-3 mb-1">
          {trimmed.slice(4)}
        </p>
      )
      i++
      continue
    }
    if (trimmed.startsWith('## ')) {
      nodes.push(
        <p key={key++} className="text-xs font-bold text-text-secondary uppercase tracking-wider mt-3 mb-1">
          {trimmed.slice(3)}
        </p>
      )
      i++
      continue
    }
    if (trimmed.startsWith('# ')) {
      nodes.push(
        <p key={key++} className="text-sm font-bold text-text-primary mt-3 mb-1">
          {trimmed.slice(2)}
        </p>
      )
      i++
      continue
    }

    // Horizontal rule
    if (trimmed === '---' || trimmed === '***') {
      nodes.push(<hr key={key++} className="border-white/10 my-2" />)
      i++
      continue
    }

    // Bullet / list items
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')) {
      const listItems: React.ReactNode[] = []
      while (
        i < lines.length &&
        (lines[i].trim().startsWith('- ') ||
          lines[i].trim().startsWith('• ') ||
          lines[i].trim().startsWith('* '))
      ) {
        const content = lines[i].trim().slice(2)
        listItems.push(
          <li key={i} className="flex gap-1.5 text-xs text-text-secondary leading-relaxed">
            <span className="text-text-tertiary mt-0.5 flex-shrink-0">·</span>
            <span>{renderInline(content)}</span>
          </li>
        )
        i++
      }
      nodes.push(
        <ul key={key++} className="space-y-1 my-1">
          {listItems}
        </ul>
      )
      continue
    }

    // Numbered list
    if (/^\d+\.\s/.test(trimmed)) {
      const listItems: React.ReactNode[] = []
      let num = 1
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        const content = lines[i].trim().replace(/^\d+\.\s/, '')
        listItems.push(
          <li key={i} className="flex gap-1.5 text-xs text-text-secondary leading-relaxed">
            <span className="text-text-tertiary flex-shrink-0 font-mono text-[10px] mt-0.5 w-4">{num}.</span>
            <span>{renderInline(content)}</span>
          </li>
        )
        i++
        num++
      }
      nodes.push(
        <ol key={key++} className="space-y-1 my-1">
          {listItems}
        </ol>
      )
      continue
    }

    // Draft block (starts with [DRAFT)
    if (trimmed.startsWith('[DRAFT') || trimmed.startsWith('**[DRAFT')) {
      // Collect lines until we hit the closing ---
      const draftLines: string[] = [trimmed]
      i++
      while (i < lines.length && lines[i].trim() !== '---') {
        draftLines.push(lines[i].trim())
        i++
      }
      if (i < lines.length) {
        // consume the closing ---
        i++
        // consume "Not sent..." line if present
        if (i < lines.length && lines[i].toLowerCase().includes('not sent')) {
          draftLines.push(lines[i].trim())
          i++
        }
      }
      nodes.push(
        <div key={key++} className="mt-2 rounded-lg border border-accent-blue/30 bg-accent-blue/5 p-3">
          <p className="text-[10px] font-mono font-bold text-accent-blue mb-2 uppercase tracking-wider">Draft Reply (not sent)</p>
          {draftLines.map((dl, di) => (
            <p key={di} className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{dl.replace(/^\*\*|\*\*$/g, '')}</p>
          ))}
        </div>
      )
      continue
    }

    // ✅ action confirmation lines
    if (trimmed.startsWith('✅')) {
      nodes.push(
        <p key={key++} className="text-xs text-brand-green font-medium flex gap-1.5 items-start my-1">
          <span className="flex-shrink-0">✅</span>
          <span>{renderInline(trimmed.slice(2).trim())}</span>
        </p>
      )
      i++
      continue
    }

    // Normal paragraph
    nodes.push(
      <p key={key++} className="text-xs text-text-secondary leading-relaxed">
        {renderInline(trimmed)}
      </p>
    )
    i++
  }

  return nodes
}

// ─── Action card ──────────────────────────────────────────────────────────────

function ActionCard({ action }: { action: AgentAction }) {
  const isCreate = action.type === 'task_created' || action.type === 'lead_created'
  const isTask = action.type === 'task_created' || action.type === 'task_updated'

  return (
    <div className="flex items-center gap-2 rounded-lg border border-brand-green/20 bg-brand-green/5 px-3 py-2">
      {isTask ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-brand-green flex-shrink-0" />
      ) : (
        <UserPlus className="w-3.5 h-3.5 text-brand-green flex-shrink-0" />
      )}
      <div className="min-w-0">
        <p className="text-[10px] text-brand-green font-bold uppercase tracking-wider">
          {action.type === 'task_created' && 'Task created'}
          {action.type === 'task_updated' && 'Task updated'}
          {action.type === 'lead_created' && 'Lead created'}
          {action.type === 'lead_updated' && 'Lead updated'}
        </p>
        <p className="text-[11px] text-text-secondary truncate">{action.label}</p>
      </div>
      {isCreate && (
        <span className="ml-auto text-[10px] text-brand-green font-mono">NEW</span>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface AgentPanelProps {
  open: boolean
  onClose: () => void
}

export function AgentPanel({ open, onClose }: AgentPanelProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [apiHistory, setApiHistory] = useState<ApiMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open && inputRef.current && messages.length > 0) {
      inputRef.current.focus()
    }
  }, [open, messages.length])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return

    const userMsg: DisplayMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: text.trim(),
    }

    const newApiHistory: ApiMessage[] = [
      ...apiHistory,
      { role: 'user', content: text.trim() },
    ]

    setMessages(prev => [...prev, userMsg])
    setApiHistory(newApiHistory)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: newApiHistory }),
      })

      const data = await res.json()

      if (!res.ok) {
        setMessages(prev => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'assistant',
            text: data.error || 'Something went wrong. Check ANTHROPIC_API_KEY is configured.',
            error: true,
          },
        ])
        return
      }

      const assistantMsg: DisplayMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        text: data.reply || '',
        actions: data.actions_taken?.length ? data.actions_taken : undefined,
      }

      setMessages(prev => [...prev, assistantMsg])
      setApiHistory(prev => [...prev, { role: 'assistant', content: data.reply || '' }])
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          text: 'Network error — could not reach the agent. Check your connection.',
          error: true,
        },
      ])
    } finally {
      setLoading(false)
    }
  }, [apiHistory, loading])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const clearHistory = () => {
    setMessages([])
    setApiHistory([])
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 md:hidden"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full sm:w-[420px] z-50 flex flex-col bg-[#0E0E16] border-l border-white/[0.07] shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-white/[0.07] flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand-green/15 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-brand-green" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary leading-none">CB Agent</p>
              <p className="text-[10px] text-text-tertiary mt-0.5">Ops Intelligence</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-[10px] text-text-tertiary hover:text-text-secondary transition-colors flex items-center gap-1"
                title="Clear conversation"
              >
                <RefreshCw className="w-3 h-3" />
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-white/5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick actions */}
        {messages.length === 0 && (
          <div className="flex-shrink-0 px-4 pt-4 pb-2">
            <p className="text-[10px] text-text-tertiary uppercase tracking-wider mb-2.5">
              Quick actions
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_ACTIONS.map(qa => (
                <button
                  key={qa.label}
                  onClick={() => sendMessage(qa.prompt)}
                  disabled={loading}
                  className="text-left px-3 py-2.5 rounded-lg border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center py-8">
              <div className="w-12 h-12 rounded-xl bg-brand-green/10 flex items-center justify-center mb-3">
                <Zap className="w-5 h-5 text-brand-green" />
              </div>
              <p className="text-sm font-medium text-text-secondary">Clean Buddies Intelligence</p>
              <p className="text-[11px] text-text-tertiary mt-1 max-w-[200px]">
                Ask me anything about the business or pick a quick action above.
              </p>
            </div>
          )}

          {messages.map(msg => (
            <div
              key={msg.id}
              className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            >
              {msg.role === 'user' ? (
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-green/15 border border-brand-green/20 px-3.5 py-2.5">
                  <p className="text-xs text-text-primary leading-relaxed">{msg.text}</p>
                </div>
              ) : (
                <div className="w-full space-y-2">
                  {/* Message bubble */}
                  <div
                    className={`rounded-2xl rounded-tl-sm px-3.5 py-3 border ${
                      msg.error
                        ? 'border-accent-red/30 bg-accent-red/5'
                        : 'border-white/[0.07] bg-white/[0.03]'
                    }`}
                  >
                    {msg.error ? (
                      <p className="text-xs text-accent-red">{msg.text}</p>
                    ) : (
                      <div className="space-y-0.5">{renderMarkdown(msg.text)}</div>
                    )}
                  </div>

                  {/* Action cards */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="space-y-1.5 pl-1">
                      {msg.actions.map((action, i) => (
                        <ActionCard key={i} action={action} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Loading state */}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-tl-sm px-3.5 py-3 border border-white/[0.07] bg-white/[0.03]">
                <div className="flex items-center gap-1.5">
                  <div className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-brand-green/60 animate-pulse"
                        style={{ animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </div>
                  <span className="text-[11px] text-text-tertiary">Checking the system…</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Collapse/expand quick actions when in conversation */}
        {messages.length > 0 && (
          <div className="flex-shrink-0 border-t border-white/[0.05]">
            <button
              onClick={() => setShowHistory(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <span>Quick actions</span>
              {showHistory ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </button>
            {showHistory && (
              <div className="px-4 pb-3 grid grid-cols-2 gap-1.5">
                {QUICK_ACTIONS.map(qa => (
                  <button
                    key={qa.label}
                    onClick={() => { sendMessage(qa.prompt); setShowHistory(false) }}
                    disabled={loading}
                    className="text-left px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] transition-all text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40"
                  >
                    {qa.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Input area */}
        <div className="flex-shrink-0 border-t border-white/[0.07] px-3 py-3">
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="Ask anything about the business…"
              rows={1}
              className="flex-1 resize-none bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:border-brand-green/40 focus:bg-white/[0.06] transition-all disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ minHeight: '38px' }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className="w-9 h-9 rounded-xl bg-brand-green flex items-center justify-center text-black flex-shrink-0 hover:bg-brand-green/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-text-tertiary mt-1.5 px-1">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </>
  )
}
