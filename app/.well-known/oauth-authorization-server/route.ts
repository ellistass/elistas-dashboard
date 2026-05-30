// app/.well-known/oauth-authorization-server/route.ts
//
// Companion to oauth-protected-resource — claude.ai probes this URL during
// connector registration. Returning 404 JSON tells the client "no
// authorization server is hosted here", which is correct: our MCP server
// uses a URL-embedded shared secret, not OAuth.
import { NextResponse } from 'next/server'

export const dynamic = 'force-static'

export function GET() {
  return NextResponse.json(
    { error: 'not_found', error_description: 'This origin does not host an OAuth authorization server.' },
    { status: 404 },
  )
}
