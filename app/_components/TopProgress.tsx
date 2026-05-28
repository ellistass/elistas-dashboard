'use client'
// app/_components/TopProgress.tsx
// Thin green progress bar pinned to the top of the screen. Fires as soon as
// any internal <a>/<Link> is clicked (so the user gets instant feedback even
// while the new page is still being compiled / fetched), then races to
// completion when the pathname actually changes.
//
// Implementation note: we attach a single capturing click listener on document
// rather than wrapping every Link — works with both Next <Link> and plain <a>.

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

type Phase = 'idle' | 'loading' | 'done'

export function TopProgress() {
  const pathname = usePathname()
  const search = useSearchParams()
  const [phase, setPhase] = useState<Phase>('idle')
  const lastRouteRef = useRef<string>('')

  // When the route actually changes, finish the bar (jump to 100, then fade).
  useEffect(() => {
    const current = `${pathname}?${search?.toString() ?? ''}`
    if (lastRouteRef.current && current !== lastRouteRef.current) {
      setPhase('done')
      const t = setTimeout(() => setPhase('idle'), 350)
      return () => clearTimeout(t)
    }
    lastRouteRef.current = current
  }, [pathname, search])

  // Listen for internal link clicks anywhere on the page.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Respect modifier-click / right-click / middle-click — those open new tabs
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      const target = e.target as HTMLElement | null
      const link = target?.closest('a') as HTMLAnchorElement | null
      if (!link) return

      const href = link.getAttribute('href')
      if (!href) return
      // Ignore external links, hash links, and downloads
      if (
        href.startsWith('http') ||
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        link.target === '_blank' ||
        link.hasAttribute('download')
      ) return

      // Ignore navigation to the page we're already on (no transition would fire)
      try {
        const url = new URL(link.href, window.location.href)
        if (url.pathname === window.location.pathname && url.search === window.location.search) return
      } catch { /* ignore */ }

      setPhase('loading')
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        height: 2,
        zIndex: 9999,
        pointerEvents: 'none',
        background: 'var(--green)',
        boxShadow: '0 0 12px rgba(0, 212, 138, 0.55)',
        transformOrigin: 'left',
        opacity:
          phase === 'loading' ? 1 :
          phase === 'done'    ? 1 : 0,
        transform:
          phase === 'loading' ? 'scaleX(0.7)' :
          phase === 'done'    ? 'scaleX(1)'   : 'scaleX(0)',
        transition:
          phase === 'loading' ? 'transform 1.6s cubic-bezier(0.1, 0.7, 0.1, 0.95), opacity 0.08s linear' :
          phase === 'done'    ? 'transform 0.18s ease-out, opacity 0.3s ease-out 0.1s' :
                                'none',
      }}
    />
  )
}
