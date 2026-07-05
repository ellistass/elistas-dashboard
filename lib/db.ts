// lib/db.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const db = globalForPrisma.prisma || new PrismaClient()

// Cache the client on the global in ALL environments. On Vercel, module scope
// usually persists per warm lambda, but paths that re-evaluate modules can
// otherwise spawn extra clients — each holding pooled connections that
// pgbouncer eventually runs out of (the intermittent "app won't load" 500s).
globalForPrisma.prisma = db
