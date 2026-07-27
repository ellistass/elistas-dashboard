'use client'
// app/_components/Sidebar.tsx
// Left-rail navigation (v2 redesign shell). Always visible on desktop,
// slide-in drawer on mobile. Hidden entirely on /login.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { useEffect, useState } from 'react'
import {
  Gauge, Crosshair, CalendarDays, PenLine,
  TrendingUp, Trophy, History as HistoryIcon,
  Wallet, Database, Pencil, LogOut, Menu, Frame,
  type LucideIcon,
} from 'lucide-react'

interface NavItem { href: string; label: string; icon: LucideIcon; input?: boolean }
interface NavGroup { label: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    label: 'Trading',
    items: [
      { href: '/',              label: 'Dashboard', icon: Gauge },
      { href: '/trades/active', label: 'Active',    icon: Crosshair },
      { href: '/calendar',      label: 'Calendar',  icon: CalendarDays },
      { href: '/journal',       label: 'Journal',   icon: PenLine, input: true },
    ],
  },
  {
    label: 'Analysis',
    items: [
      // Screener (/scanner, H4 ADX trend sweep) retired 2026-07-26 — Wyckoff
      // replaced it as the daily process. Route still exists; restore the line
      // below (and TREND_LANE_ENABLED in api/cron/trade-scan) to bring it back.
      // { href: '/scanner',    label: 'Screener',   icon: Radar },  // (re-add Radar to the lucide import too)
      { href: '/wyckoff',    label: 'Wyckoff',    icon: Frame, input: true },
      { href: '/analytics',  label: 'Stats',      icon: TrendingUp },
      { href: '/scoreboard', label: 'Scoreboard', icon: Trophy },
      { href: '/analysis',   label: 'History',    icon: HistoryIcon },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: '/accounts',    label: 'Accounts',    icon: Wallet, input: true },
      { href: '/data/latest', label: 'Market data', icon: Database },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => { setDrawerOpen(false) }, [pathname])

  if (pathname?.startsWith('/login')) return null

  const sidebarBody = (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      padding: '16px 12px', minWidth: 0,
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="pulse-dot" style={{
          width: 8, height: 8, borderRadius: '50%',
          background: 'var(--accent)', display: 'inline-block',
          boxShadow: '0 0 10px rgba(58,212,236,0.6)', flexShrink: 0,
        }} />
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 500, letterSpacing: '0.2em', color: 'var(--text-1)' }}>
          ELISTAS
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'DM Mono, monospace', fontSize: 10, color: 'var(--text-3)' }}>v2</span>
      </div>

      {/* Nav groups */}
      <nav style={{ flex: 1, overflow: 'auto', paddingTop: 12 }}>
        {GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 18 }}>
            <p style={{
              fontFamily: 'DM Mono, monospace',
              fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.16em',
              textTransform: 'uppercase', margin: '0 0 6px', padding: '0 8px',
            }}>{group.label}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {group.items.map((item) => {
                const active = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href))
                const Icon = item.icon
                return (
                  <Link key={item.href} href={item.href} style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '7px 10px', borderRadius: 6,
                    fontSize: 12.5,
                    color: active ? 'var(--text-1)' : 'var(--text-label)',
                    background: active ? 'var(--border-subtle)' : 'transparent',
                    textDecoration: 'none',
                    transition: 'background 0.1s, color 0.1s',
                    borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                  }}>
                    <Icon size={14} strokeWidth={2} style={{ flexShrink: 0, opacity: active ? 1 : 0.75 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                    {item.input && (
                      <Pencil size={11} strokeWidth={2} style={{ marginLeft: 'auto', color: 'var(--text-3)', flexShrink: 0 }} />
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User / sign-out at bottom */}
      {session?.user && (
        <div style={{ padding: '12px 8px 0', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: 'var(--text-3)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
               title={session.user.email ?? undefined}>
            {session.user.email}
          </div>
          <button onClick={() => signOut({ callbackUrl: '/login' })} style={{
            width: '100%', padding: '7px 10px', fontSize: 11,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: 'transparent', color: 'var(--text-2)',
            border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer',
            fontFamily: 'Sora, sans-serif',
          }}>
            <LogOut size={12} strokeWidth={2} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <>
        {/* Mobile top bar */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 50,
          background: 'rgba(10,11,15,0.92)', backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px',
        }}>
          <button onClick={() => setDrawerOpen(true)} aria-label="Open menu" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-1)', padding: 0, lineHeight: 1, display: 'flex',
          }}>
            <Menu size={20} strokeWidth={2} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.2em' }}>ELISTAS</span>
          </div>
          <div style={{ width: 20 }} />
        </div>

        {/* Drawer */}
        {drawerOpen && (
          <>
            <div onClick={() => setDrawerOpen(false)} style={{
              position: 'fixed', inset: 0, zIndex: 99,
              background: 'rgba(4,5,9,0.66)', backdropFilter: 'blur(3px)',
            }} />
            <aside style={{
              position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 100,
              width: 240, background: 'var(--bg-sidebar)',
              borderRight: '1px solid var(--border-subtle)',
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
      width: 210, background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border-subtle)',
      overflow: 'auto',
    }}>{sidebarBody}</aside>
  )
}
