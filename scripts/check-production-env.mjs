import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const files = ['.env', '.env.local']
const externalEnv = new Set(Object.keys(process.env))

for (const file of files) {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) continue

  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue

    const [, key, rawValue] = match
    if (externalEnv.has(key)) continue

    let value = rawValue.trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!value) continue
    process.env[key] = value
  }
}

const required = [
  'DATABASE_URL',
  'DIRECT_URL',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
  'CRON_SECRET',
  'ROUTINE_SECRET',
  'ANTHROPIC_API_KEY',
  'MCP_PUBLIC_SECRET',
]

const warnings = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']

const placeholderPatterns = [
  /^\s*$/,
  /\[PROJECT\]/i,
  /\[PASSWORD\]/i,
  /\[REGION\]/i,
  /^your-/i,
  /^generate-/i,
  /placeholder/i,
]

function isMissingOrPlaceholder(key) {
  const value = process.env[key] ?? ''
  return placeholderPatterns.some((pattern) => pattern.test(value))
}

function isValidUrl(key) {
  try {
    new URL(process.env[key])
    return true
  } catch {
    return false
  }
}

const missing = required.filter(isMissingOrPlaceholder)
const invalid = []

for (const key of ['NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
  if (!missing.includes(key) && !isValidUrl(key)) invalid.push(`${key} must be a valid URL`)
}

if (process.env.NEXTAUTH_URL?.endsWith('/')) {
  invalid.push('NEXTAUTH_URL must not end with a trailing slash')
}

if (process.env.NEXT_PUBLIC_APP_URL?.endsWith('/')) {
  invalid.push('NEXT_PUBLIC_APP_URL must not end with a trailing slash')
}

if (process.env.NEXTAUTH_SECRET && process.env.NEXTAUTH_SECRET.length < 32) {
  invalid.push('NEXTAUTH_SECRET must be at least 32 characters')
}

const missingWarnings = warnings.filter(isMissingOrPlaceholder)

if (missing.length || invalid.length) {
  console.error('\nProduction preflight failed.')
  if (missing.length) {
    console.error(`Missing or placeholder env vars: ${missing.join(', ')}`)
  }
  if (invalid.length) {
    console.error(`Invalid env vars: ${invalid.join('; ')}`)
  }
  console.error('\nFix Vercel Production env vars, then redeploy. See .env.example for names.')
  process.exit(1)
}

if (missingWarnings.length) {
  console.warn(`Production preflight warning: optional env vars not set: ${missingWarnings.join(', ')}`)
}

console.log('Production preflight passed.')
