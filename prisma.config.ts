import path from 'node:path'
import { defineConfig } from '@prisma/config'
import { config } from 'dotenv'

// Load .env.local for the Prisma CLI in local dev (Next.js loads it automatically,
// the Prisma CLI does not). On Vercel there is no .env.local — DATABASE_URL comes
// from the project's environment variables instead, so this is a harmless no-op there.
config({ path: path.join(__dirname, '.env.local') })

export default defineConfig({
  schema: path.join(__dirname, 'prisma/schema.prisma'),
  migrations: {
    seed: 'npx tsx ./prisma/seed.ts',
  },
  datasource: {
    // Read process.env directly rather than @prisma/config's env(), which THROWS
    // when the var is missing. `prisma generate` runs in the Vercel build with no
    // DATABASE_URL and doesn't need a live URL; migrate/db push do, and will fail
    // with a clear error if it's genuinely unset when those run.
    url: process.env.DATABASE_URL,
  },
})
