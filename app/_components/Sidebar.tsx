'use client'
// app/_components/Sidebar.tsx
// Left-rail navigation. Always visible on desktop, slide-in drawer on mobile.
// Hidden entirely on /login.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { useEffect, useState } from 'react'

interface NavItem { href: string; label: string; icon?: string }
interface NavGroup { label: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    label: 'Trading',
    items: [
      { href: '/',              label: 'Dashboard',   icon: '⚡' },
      { href: '/trades/active', label: 'Active',      icon: '◉' },
      { href: '/calendar',      label: 'Calendar',    icon: '▣' },
      { href: '/journal',       label: 'Journal',     icon: '✎' },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { href: '/analytics',  label: 'Stats',       icon: '∿' },
      { href: '/scoreboard', label: 'Scoreboard',  icon: '◎' },
      { href: '/analysis',   label: 'History',     icon: '⋯' },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: '/accounts',    label: 'Accounts',    icon: '◫' },
      { href: '/data/latest', label: 'Market data', icon: '⊞' },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Track viewport so we know whether to render the drawer or the static sidebar
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Close drawer when route changes
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  if (pathname?.startsWith('/login')) return null

  const sidebarBody = (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      padding: '14px 12px', minWidth: 0,
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 14px', borderBottom: '1px solid var(--border)' }}>
        <span className="pulse-dot" style={{
          width: 7, height: 7, borderRadius: '50%',
          background: 'var(--green)', display: 'inline-block',
          boxShadow: '0 0 10px rgba(0,212,138,0.6)', flexShrink: 0,
        }} />
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 500, letterSpacing: '0.16em', color: 'var(--text-1)' }}>
          ELISTAS
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-3)' }}>v1</span>
      </div>

      {/* Nav groups */}
      <nav style={{ flex: 1, overflow: 'auto', paddingTop: 10 }}>
        {GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 16 }}>
            <p style={{
              fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.14em',
              textTransform: 'uppercase', margin: '0 0 6px', padding: '0 8px',
            }}>{group.label}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {group.items.map((item) => {
                const active = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href))
                return (
                  <Link key={item.href} href={item.href} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', borderRadius: 6,
                    fontSize: 12,
                    color: active ? 'var(--text-1)' : 'var(--text-2)',
                    background: active ? 'var(--bg-elevated)' : 'transparent',
                    textDecoration: 'none',
                    transition: 'background 0.1s, color 0.1s',
                    borderLeft: active ? '2px solid var(--green)' : '2px solid transparent',
                  }}>
                    <span style={{ fontSize: 13, opacity: 0.7, width: 14, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User / sign-out at bottom */}
      {session?.user && (
        <div style={{ padding: '10px 8px 0', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
               title={session.user.email ?? undefined}>
            {session.user.email}
          </div>
          <button onClick={() => signOut({ callbackUrl: '/login' })} style={{
            width: '100%', padding: '6px 10px', fontSize: 11,
            background: 'transparent', color: 'var(--text-2)',
            border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
          }}>Sign out</button>
        </div>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <>
        {/* Mobile top bar — only shows on mobile */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 50,
          background: 'rgba(9,9,15,0.92)', backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px',
        }}>
          <button onClick={() => setDrawerOpen(true)} aria-label="Open menu" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-1)', fontSize: 20, padding: 0, lineHeight: 1,
          }}>☰</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.14em' }}>ELISTAS</span>
          </div>
          <div style={{ width: 20 }} />
        </div>

        {/* Drawer */}
        {drawerOpen && (
          <>
            <div onClick={() => setDrawerOpen(false)} style={{
              position: 'fixed', inset: 0, zIndex: 99,
              background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
            }} />
            <aside style={{
              position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 100,
              width: 240, background: 'var(--bg-base)',
              borderRight: '1px solid var(--border)',
              overflow: 'auto',
            }}>{sidebarBody}</aside>
          </>
        )}
      </>
    )
  }

  // Desktop — always-visible left rail
  return (
    <aside style={{
      position: 'fixed', top: 0, left: 0, bottom: 0,
      width: 200, background: 'var(--bg-base)',
      borderRight: '1px solid var(--border)',
      overflow: 'auto',
    }}>{sidebarBody}</aside>
  )
}
