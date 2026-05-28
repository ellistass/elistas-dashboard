// app/loading.tsx — fallback skeleton shown by Next.js whenever a route
// segment is suspended. Lightweight on purpose: a pulse dot + label.
export default function Loading() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '80px 0', gap: 10,
      fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.14em',
      color: 'var(--text-3)',
    }}>
      <span className="pulse-dot" style={{
        width: 6, height: 6, borderRadius: '50%',
        background: 'var(--green)', display: 'inline-block',
      }} />
      LOADING…
    </div>
  )
}
