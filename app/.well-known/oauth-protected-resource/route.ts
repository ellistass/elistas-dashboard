// app/.well-known/oauth-protected-resource/route.ts
//
// MCP clients (including claude.ai's custom connector flow) probe this URL
// per RFC 9728 to discover whether the server requires OAuth and, if so,
// which authorization server to use.
//
// Our MCP server (/api/mcp/<secret>/mcp) does NOT use OAuth — auth is the
// URL-embedded secret. Return 404 explicitly to signal "no OAuth metadata
// here", so claude.ai stops trying to register a client and falls back to
// hitting the MCP endpoint directly.
//
// Without this route the request would be caught by NextAuth middleware and
// redirected to /login (HTML), which claude.ai interprets as a broken
// sign-in service.
import { NextResponse } from 'next/server'

export const dynamic = 'force-static'

export function GET() {
  return NextResponse.json(
    { error: 'not_found', error_description: 'This server does not advertise OAuth metadata.' },
    { status: 404 },
  )
}
