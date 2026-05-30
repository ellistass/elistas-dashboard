// middleware.ts — gate every route behind NextAuth except:
//   • /login itself
//   • /api/auth/*           (NextAuth flow)
//   • /api/cron/*           (Vercel cron, secured by CRON_SECRET header)
//   • /api/trades/mt4/*     (MT4 EA, secured by per-account bearer apiKey)
//   • /api/mcp/*            (Claude.ai custom connector, secured by URL secret)
//   • /.well-known/*        (OAuth/MCP discovery probes — claude.ai needs JSON,
//                            not an HTML login redirect, to register a connector)
//   • /_next/*, favicon, static assets
import { withAuth } from 'next-auth/middleware'

export default withAuth({
  pages: { signIn: '/login' },
})

export const config = {
  matcher: [
    // protect everything EXCEPT the carved-out paths in the negative lookahead
    '/((?!login|api/auth|api/cron|api/trades/mt4|api/mcp|\\.well-known|_next/static|_next/image|favicon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)).*)',
  ],
}
