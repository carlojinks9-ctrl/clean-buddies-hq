'use client'
import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Mail, ExternalLink } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface GmailMessage {
  id: string
  from: string
  subject: string
  date: string
  isGc: boolean
  snippet: string
}

function parseSenderName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</)
  if (match) return match[1].trim()
  const emailMatch = from.match(/<(.+)>/)
  return emailMatch ? emailMatch[1] : from
}

export function GmailWidget() {
  const [messages, setMessages] = useState<GmailMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(true)
  const [totalUnread, setTotalUnread] = useState(0)

  useEffect(() => {
    fetch('/api/sync/gmail')
      .then(r => r.json())
      .then(data => {
        if (data.error === 'Google not connected') {
          setConnected(false)
        } else {
          setMessages(data.messages || [])
          setTotalUnread(data.total_unread || 0)
        }
      })
      .catch(() => setConnected(false))
      .finally(() => setLoading(false))
  }, [])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-text-tertiary" />
          <CardTitle>Inbox</CardTitle>
          {totalUnread > 0 && (
            <span className="text-[10px] bg-accent-blue/15 text-accent-blue px-1.5 py-0.5 rounded-full font-medium">
              {totalUnread} unread
            </span>
          )}
        </div>
        <a
          href="https://mail.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors flex items-center gap-1"
        >
          Open Gmail <ExternalLink className="w-3 h-3" />
        </a>
      </CardHeader>

      <div className="divide-y divide-white/[0.04]">
        {loading ? (
          <div className="px-4 py-4 space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-3 bg-white/[0.06] rounded w-24" />
                  <div className="h-2.5 bg-white/[0.04] rounded w-16 ml-auto" />
                </div>
                <div className="h-3 bg-white/[0.05] rounded w-3/4" />
              </div>
            ))}
          </div>
        ) : !connected ? (
          <div className="px-4 py-6 text-center space-y-2">
            <Mail className="w-6 h-6 text-text-tertiary mx-auto opacity-40" />
            <p className="text-xs text-text-tertiary">Gmail not connected</p>
            <a href="/settings" className="text-xs text-accent-blue hover:underline">Connect Google →</a>
          </div>
        ) : messages.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-text-tertiary">
            No unread messages
          </div>
        ) : (
          messages.map(msg => (
            <div
              key={msg.id}
              className={`px-4 py-3 hover:bg-white/[0.02] transition-colors ${msg.isGc ? 'border-l-2 border-accent-amber' : ''}`}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className={`text-xs font-medium truncate ${msg.isGc ? 'text-accent-amber' : 'text-text-primary'}`}>
                  {parseSenderName(msg.from)}
                </span>
                {msg.date && (
                  <span className="text-[10px] text-text-tertiary font-mono flex-shrink-0">
                    {formatDistanceToNow(new Date(msg.date), { addSuffix: false })}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-text-secondary truncate">{msg.subject}</p>
              {msg.snippet && (
                <p className="text-[10px] text-text-tertiary truncate mt-0.5">{msg.snippet}</p>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  )
}
