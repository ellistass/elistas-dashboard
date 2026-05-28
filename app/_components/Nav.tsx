'use client'
// app/_components/Nav.tsx — top navigation bar. Hidden on /login.
// Reads session via useSession to show the current user + sign-out button.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'

const links = [
  { href: '/',                label: 'Dashboard' },
  { href: '/trades/active',   label: 'Active'    },
  { href: '/accounts',        label: 'Accounts'  },
  { href: '/journal',         label: 'Journal'   },
  { href: '/calendar',        label: 'Calendar'  },
  { href: '/analysis',        label: 'Analysis'  },
  { href: '/data/latest',     label: 'Market Data' },
  { href: '/analytics',       label: 'Stats'     },
  { href: '/scoreboard',      label: 'Scoreboard' },
]

export function Nav() {
  const pathname = usePathname()
  const { data: session } = useSession()

  if (pathname?.startsWith('/login')) return null

  return (
    <nav style={{
      borderBottom: '1px solid var(--border)',
      background: 'rgba(9,9,15,0.92)',
      backdropFilter: 'blur(12px)',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: 'var(--green)',
              display: 'inline-block',
              animation: 'pulse-dot 2s ease-in-out infinite',
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          {links.map(({ href, label }) => (
            <Link key={href} href={href} className="nav-link">{label}</Link>
          ))}
          {session?.user && (
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              style={{
                fontSize: 12,
                color: 'var(--text-3)',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
              title={session.user.email ?? undefined}
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </nav>
  )
}
