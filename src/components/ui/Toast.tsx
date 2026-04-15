'use client'
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'

export type ToastType = 'success' | 'error'

export interface ToastMessage {
  id: string
  type: ToastType
  text: string
}

interface ToastProps {
  toast: ToastMessage
  onDismiss: (id: string) => void
}

function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 3000)
    return () => clearTimeout(t)
  }, [toast.id, onDismiss])

  return (
    <div
      className={clsx(
        'flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-2xl border text-sm font-medium',
        'animate-slide-up pointer-events-auto',
        toast.type === 'success'
          ? 'bg-bg-elevated border-brand-green/25 text-text-primary'
          : 'bg-bg-elevated border-accent-red/25 text-text-primary'
      )}
    >
      {toast.type === 'success'
        ? <CheckCircle2 className="w-4 h-4 text-brand-green flex-shrink-0" />
        : <AlertCircle className="w-4 h-4 text-accent-red flex-shrink-0" />
      }
      <span>{toast.text}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="ml-1 text-text-tertiary hover:text-text-primary transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Global toast state (module-level singleton) ──────────────────────────────

type Listener = (toasts: ToastMessage[]) => void
let toasts: ToastMessage[] = []
const listeners: Set<Listener> = new Set()

function notify() {
  listeners.forEach(l => l([...toasts]))
}

export function toast(text: string, type: ToastType = 'success') {
  const id = Math.random().toString(36).slice(2)
  toasts = [...toasts, { id, type, text }]
  notify()
}

function dismiss(id: string) {
  toasts = toasts.filter(t => t.id !== id)
  notify()
}

// ── Toast container (mount once in layout or page) ──────────────────────────

export function ToastContainer() {
  const [items, setItems] = useState<ToastMessage[]>([])

  useEffect(() => {
    listeners.add(setItems)
    return () => { listeners.delete(setItems) }
  }, [])

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
      {items.map(t => (
        <Toast key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  )
}
