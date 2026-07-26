// middleware.ts — gate every route behind NextAuth except:
//   • /login itself
//   • /api/auth/*                 (NextAuth flow)
//   • /api/cron/*                 (Vercel cron, secured by CRON_SECRET header)
//   • /api/trades/mt4/*           (MT4 EA, secured by per-account bearer apiKey)
//   • /api/mcp/*                  (Claude.ai custom connector, secured by URL secret)
//   • /api/scoring/prompt-data    (Bearer ROUTINE_SECRET — called by the MCP
//                                  server's internal hop and by external routines)
//   • /api/scoring/save           (Bearer ROUTINE_SECRET — same flow)
//   • /api/scanner/*              (Bearer ROUTINE_SECRET — Wyckoff scan, called
//                                  by the MCP server's internal hop)
//   • /.well-known/*              (OAuth/MCP discovery probes — claude.ai needs
//                                  JSON, not an HTML login redirect)
//   • /_next/*, favicon, static assets
//
// Note: /api/scoring/routine-config is intentionally NOT carved out — it uses
// getServerSession to require a logged-in dashboard user.
import { withAuth } from 'next-auth/middleware'

export default withAuth({
  pages: { signIn: '/login' },
})

export const config = {
  matcher: [
    // protect everything EXCEPT the carved-out paths in the negative lookahead
    '/((?!login|api/auth|api/cron|api/trades/mt4|api/mcp|api/scoring/prompt-data|api/scoring/save|api/scanner|\\.well-known|_next/static|_next/image|favicon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)).*)',
  ],
}
