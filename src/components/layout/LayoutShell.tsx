'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Zap } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { ToastContainer } from '@/components/ui/Toast'
import { AgentPanel } from '@/components/agent/AgentPanel'

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  // Login page: no chrome
  if (pathname === '/login') {
    return (
      <>
        {children}
        <ToastContainer />
      </>
    )
  }

  return (
    <>
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="md:ml-[220px] min-h-screen flex flex-col">
        <Header onMenuToggle={() => setSidebarOpen(p => !p)} />
        <main className="flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>

      {/* CB Agent panel */}
      <AgentPanel open={agentOpen} onClose={() => setAgentOpen(false)} />

      {/* Agent trigger button — bottom-right floating */}
      {!agentOpen && (
        <button
          onClick={() => setAgentOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-brand-green text-black font-semibold text-sm shadow-lg shadow-brand-green/20 hover:bg-brand-green/90 transition-all hover:shadow-brand-green/30 hover:shadow-xl active:scale-95"
          aria-label="Open CB Agent"
        >
          <Zap className="w-4 h-4" />
          CB Agent
        </button>
      )}

      <ToastContainer />
    </>
  )
}
