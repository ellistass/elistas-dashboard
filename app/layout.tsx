// app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'RFDM Trading System',
  description: 'Relative Flow Divergence Model — Currency strength scoring, session alerts, trade journal',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-paper text-ink antialiased">
        <nav className="border-b border-gray-200 bg-white sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium tracking-wider text-gray-400">RFDM</span>
              <span className="text-gray-200">|</span>
              <span className="font-sans text-sm font-medium">Trading System</span>
            </div>
            <div className="flex items-center gap-6">
              <a href="/" className="text-sm text-gray-600 hover:text-black transition-colors">Alerts</a>
              <a href="/journal" className="text-sm text-gray-600 hover:text-black transition-colors">Journal</a>
              <a href="/analytics" className="text-sm text-gray-600 hover:text-black transition-colors">Analytics</a>
            </div>
          </div>
        </nav>
        <main className="max-w-6xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
