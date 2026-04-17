import type { Metadata } from 'next'
import './globals.css'
import { LayoutShell } from '@/components/layout/LayoutShell'
import { PwaInit } from '@/components/layout/PwaInit'

export const metadata: Metadata = {
  title: 'Clean Buddies HQ',
  description: 'Operations command center for Clean Buddies LLC',
  icons: {
    icon: [
      { url: '/api/icon/32', sizes: '32x32', type: 'image/png' },
      { url: '/api/icon/192', sizes: '192x192', type: 'image/png' },
      { url: '/icons/clean-buddies-logo.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/api/icon/180', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/manifest.json',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />

        {/* PWA */}
        <meta name="theme-color" content="#1D9E75" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="CB HQ" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* PNG apple-touch-icon required by iOS Safari — SVG is ignored */}
        <link rel="apple-touch-icon" sizes="180x180" href="/api/icon/180" />
        <link rel="apple-touch-icon" sizes="152x152" href="/api/icon/152" />
        <link rel="apple-touch-icon" sizes="120x120" href="/api/icon/120" />
      </head>
      <body className="bg-bg-base text-text-primary antialiased">
        <PwaInit />
        <LayoutShell>
          {children}
        </LayoutShell>
      </body>
    </html>
  )
}
