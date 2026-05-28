// scripts/create-user.ts — one-off seed for the single dashboard user.
// Usage: npm run create-user -- you@example.com 'your-password'
//
// The password is hashed with bcrypt and ONLY the hash is stored.
// If the user already exists, the password is updated in place.
// Env vars come from .env (loaded by tsx --env-file in package.json).
import bcrypt from 'bcryptjs'
import { db } from '../lib/db'

async function main() {
  const [, , email, password, name] = process.argv

  if (!email || !password) {
    console.error('Usage: npm run create-user -- <email> <password> [name]')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.')
    process.exit(1)
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const lowered = email.toLowerCase().trim()

  const user = await db.user.upsert({
    where: { email: lowered },
    create: { email: lowered, passwordHash, name: name ?? null },
    update: { passwordHash, name: name ?? undefined },
  })

  console.log(`✓ User ready: ${user.email} (id=${user.id})`)
  console.log('  You can now sign in at /login.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
