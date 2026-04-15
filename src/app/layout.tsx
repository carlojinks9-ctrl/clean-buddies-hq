import type { Metadata } from 'next'
import './globals.css'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { ToastContainer } from '@/components/ui/Toast'

export const metadata: Metadata = {
  title: 'Clean Buddies HQ',
  description: 'Operations command center for Clean Buddies LLC',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-bg-base text-text-primary antialiased">
        <Sidebar />
        <div className="ml-[220px] min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 p-6">
            {children}
          </main>
        </div>
        <ToastContainer />
      </body>
    </html>
  )
}
