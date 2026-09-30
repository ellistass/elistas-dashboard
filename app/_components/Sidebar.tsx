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
  Wallet, Database, Pencil, LogOut, Menu, Frame, Target, Briefcase, ShieldCheck, Moon, Sun, CalendarRange, BookMarked,
  type LucideIcon,
} from 'lucide-react'

interface NavItem { href: string; label: string; icon: LucideIcon; input?: boolean }

/** Light / dark switch. The choice lives in localStorage; layout.tsx applies it before first paint. */
function ThemeToggle() {
  const [light, setLight] = useState(false)
  useEffect(() => { setLight(document.documentElement.dataset.theme === 'light') }, [])
  const flip = () => {
    const next = !light
    setLight(next)
    if (next) document.documentElement.dataset.theme = 'light'
    else delete document.documentElement.dataset.theme
    try { localStorage.setItem('theme', next ? 'light' : 'dark') } catch { /* private mode: session only */ }
  }
  return (
    <button onClick={flip} aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'} style={{
      width: '100%', padding: '7px 10px', fontSize: 11, marginBottom: 6,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      background: 'transparent', color: 'var(--text-2)',
      border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer',
      fontFamily: 'Sora, sans-serif',
    }}>
      {light ? <Moon size={12} strokeWidth={2} /> : <Sun size={12} strokeWidth={2} />}
      {light ? 'Dark mode' : 'Light mode'}
    </button>
  )
}
interface NavGroup { label: string; items: NavItem[] }

// Swing trading restructure (spec: "Elistas Dashboard — Swing Trading Spec").
// Every page on screen answers one question. The RFDM / day-trading pages are
// HIDDEN, not deleted: their routes still work, and uncommenting a line in
// HIDDEN_ITEMS below brings one back. Shared code (data feeds, accounts) stays.
const GROUPS: NavGroup[] = [
  {
    label: 'Swing',
    items: [
      { href: '/tonight',    label: 'Tonight',    icon: Moon },                          // what do I do right now?
      { href: '/setups',     label: 'Setups',     icon: Target },                        // what's firing, and is it worth taking?
      { href: '/trades',     label: 'Trades',     icon: Briefcase, input: true },        // where are my positions and stops?
      { href: '/discipline', label: 'Discipline', icon: ShieldCheck },                   // am I following the rules?
      { href: '/month',      label: 'Month',      icon: CalendarRange },                 // am I on plan this month?
      { href: '/log',        label: 'Journal',    icon: BookMarked },                    // is the system working over time?
    ],
  },
  {
    label: 'Wyckoff',
    items: [
      { href: '/wyckoff',    label: 'Wyckoff desk', icon: Frame, input: true },          // blind reads and training
    ],
  },
]

// Hidden from the sidebar 2026-09 (swing restructure). To restore one, move its
// line back into GROUPS above.
//   RFDM / day trading:
//     { href: '/',              label: 'Dashboard',    icon: Gauge },       // "/" now redirects to /tonight (next.config.js)
//     { href: '/trades/active', label: 'Active',       icon: Crosshair },
//     { href: '/calendar',      label: 'Calendar',     icon: CalendarDays },
//     { href: '/journal',       label: 'RFDM journal', icon: PenLine, input: true },
//     { href: '/analytics',     label: 'Stats',        icon: TrendingUp },
//     { href: '/scoreboard',    label: 'Scoreboard',   icon: Trophy },
//     { href: '/analysis',      label: 'History',      icon: HistoryIcon },
//     { href: '/accounts',      label: 'Accounts',     icon: Wallet, input: true },   // MT4 prop accounts; swing books are on Month → Settings
//     { href: '/data/latest',   label: 'Market data',  icon: Database },
//   H4 trend screener (retired 2026-07-26; also TREND_LANE_ENABLED in api/cron/trade-scan):
//     { href: '/scanner',       label: 'Screener',     icon: Radar },       // re-add Radar to the lucide import
// (Their icons stay in the lucide import above so a restore is a one-line edit.)

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
                // Longest matching href wins, so /trades/active doesn't also light up /trades.
                const matches = (h: string) => pathname === h || (h !== '/' && !!pathname?.startsWith(h + '/'))
                const best = GROUPS.flatMap((g) => g.items.map((i) => i.href)).filter(matches).sort((x, y) => y.length - x.length)[0]
                const active = best === item.href
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
          <ThemeToggle />
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
