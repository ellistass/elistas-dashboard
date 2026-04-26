// app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Elistas — Trading System',
  description: 'Currency strength, session alerts, trade journal & alignment monitoring',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body style={{ background: 'var(--bg-base)', color: 'var(--text-1)' }}>
        {/* ── Top nav ── */}
        <nav style={{
          borderBottom: '1px solid var(--border)',
          background: 'rgba(9,9,15,0.92)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}>
          <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: 'var(--green)',
                  display: 'inline-block',
                  animation: 'pulse-dot 2s ease-in-out infinite'
                }} />
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 500, letterSpacing: '0.14em', color: 'var(--text-1)' }}>
                  ELISTAS
                </span>
              </div>
              <span style={{ color: 'var(--border)', margin: '0 4px' }}>|</span>
              <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>
                Trading System
              </span>
            </div>

            {/* Nav links */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
              {[
                { href: '/',          label: 'Dashboard' },
                { href: '/accounts',  label: 'Accounts'  },
                { href: '/journal',   label: 'Journal'   },
                { href: '/analysis',  label: 'Analysis'  },
                { href: '/data/latest', label: 'Market Data' },
                { href: '/analytics', label: 'Stats'     },
              ].map(({ href, label }) => (
                <a key={href} href={href} className="nav-link">{label}</a>
              ))}
            </div>
          </div>
        </nav>

        {/* ── Page content ── */}
        <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 60px' }}>
          {children}
        </main>
      </body>
    </html>
  )
}
