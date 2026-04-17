'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { ToastContainer } from '@/components/ui/Toast'

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
      {/* Mobile backdrop */}
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

      <ToastContainer />
    </>
  )
}
