// app/layout.tsx
import type { Metadata } from 'next'
import { Suspense } from 'react'
import './globals.css'
import { Providers } from './providers'
import { Sidebar } from './_components/Sidebar'
import { TopProgress } from './_components/TopProgress'

export const metadata: Metadata = {
  title: 'Elistas — Trading System',
  description: 'Currency strength, session alerts, trade journal & alignment monitoring',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before the first paint, so light mode never flashes dark. */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('theme')==='light')document.documentElement.dataset.theme='light'}catch(e){}" }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ background: 'var(--bg-base)', color: 'var(--text-1)' }}>
        <Providers>
          <Suspense fallback={null}>
            <TopProgress />
          </Suspense>
          <Sidebar />
          <main className="app-main">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
