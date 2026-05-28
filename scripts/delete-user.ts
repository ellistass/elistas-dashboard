// scripts/delete-user.ts — remove a user by email.
// Usage: npm run delete-user -- email@example.com
import { db } from '../lib/db'

async function main() {
  const [, , email] = process.argv
  if (!email) {
    console.error('Usage: npm run delete-user -- <email>')
    process.exit(1)
  }
  const lowered = email.toLowerCase().trim()
  try {
    const user = await db.user.delete({ where: { email: lowered } })
    console.log(`✓ Deleted user: ${user.email}`)
    process.exit(0)
  } catch (err: any) {
    if (err?.code === 'P2025') {
      console.log(`No user found with email: ${lowered}`)
      process.exit(0)
    }
    console.error(err)
    process.exit(1)
  }
}
main()
