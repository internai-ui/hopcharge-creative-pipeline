import path from 'node:path'
import { defineConfig, env } from '@prisma/config'
import { config } from 'dotenv'

// Load .env.local for Prisma CLI (Next.js loads it automatically, Prisma CLI does not)
config({ path: path.join(__dirname, '.env.local') })

export default defineConfig({
  schema: path.join(__dirname, 'prisma/schema.prisma'),
  migrations: {
    seed: 'npx tsx ./prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
