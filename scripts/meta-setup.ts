#!/usr/bin/env npx tsx
/**
 * Fetches META_PAGE_ID and META_CAMPAIGN_ID from the Graph API using credentials
 * already in .env.local, then patches the missing values back into the file.
 *
 * Run once after refreshing META_ACCESS_TOKEN:
 *   npm run meta:setup
 */

import fs from 'fs'
import path from 'path'

const ENV_FILE = path.join(process.cwd(), '.env.local')

function readEnv(): Record<string, string> {
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n')
  const result: Record<string, string> = {}
  for (const line of lines) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match) result[match[1]] = match[2].trim()
  }
  return result
}

function patchEnv(key: string, value: string) {
  const content = fs.readFileSync(ENV_FILE, 'utf8')
  const pattern = new RegExp(`^(${key}=).*$`, 'm')
  if (pattern.test(content)) {
    fs.writeFileSync(ENV_FILE, content.replace(pattern, `$1${value}`))
  }
}

async function main() {
  const env = readEnv()
  const token = env['META_ACCESS_TOKEN']
  const adAccountId = env['META_AD_ACCOUNT_ID']

  if (!token) {
    console.error('❌  META_ACCESS_TOKEN is not set in .env.local')
    process.exit(1)
  }

  const BASE = 'https://graph.facebook.com/v21.0'

  // ── 1. Validate token ─────────────────────────────────────────────────────
  const debugRes = await fetch(
    `${BASE}/debug_token?input_token=${token}&access_token=${env['META_APP_ID']}|${env['META_APP_SECRET']}`
  )
  const debugData = await debugRes.json()
  if (!debugData.data?.is_valid) {
    console.error('❌  Token is invalid or expired:', debugData.data?.error?.message ?? JSON.stringify(debugData))
    console.error('    Refresh your token first, then re-run this script.')
    process.exit(1)
  }
  console.log('✅  Token is valid')

  // ── 2. Fetch pages ────────────────────────────────────────────────────────
  if (!env['META_PAGE_ID']) {
    const pagesRes = await fetch(`${BASE}/me/accounts?access_token=${token}`)
    const pagesData = await pagesRes.json()

    if (pagesData.error) {
      console.error('❌  Could not fetch pages:', pagesData.error.message)
    } else if (!pagesData.data?.length) {
      console.warn('⚠️   No Facebook Pages found on this token.')
    } else if (pagesData.data.length === 1) {
      const page = pagesData.data[0]
      patchEnv('META_PAGE_ID', page.id)
      console.log(`✅  META_PAGE_ID set to ${page.id} (${page.name})`)
    } else {
      console.log('\nMultiple pages found — pick one and set META_PAGE_ID manually:')
      for (const p of pagesData.data) {
        console.log(`   ${p.id}  ${p.name}`)
      }
    }
  } else {
    console.log(`ℹ️   META_PAGE_ID already set: ${env['META_PAGE_ID']}`)
  }

  // ── 3. Fetch campaigns ────────────────────────────────────────────────────
  if (!env['META_CAMPAIGN_ID']) {
    const campaignRes = await fetch(
      `${BASE}/act_${adAccountId}/campaigns?fields=id,name,status,objective&limit=10&access_token=${token}`
    )
    const campaignData = await campaignRes.json()

    if (campaignData.error) {
      console.error('❌  Could not fetch campaigns:', campaignData.error.message)
    } else if (!campaignData.data?.length) {
      console.warn('⚠️   No campaigns found. Create one in Meta Ads Manager first.')
    } else {
      const active = campaignData.data.filter((c: {status: string}) => c.status === 'ACTIVE')
      const pick = active[0] ?? campaignData.data[0]
      patchEnv('META_CAMPAIGN_ID', pick.id)
      console.log(`✅  META_CAMPAIGN_ID set to ${pick.id} (${pick.name} · ${pick.objective})`)
      if (campaignData.data.length > 1) {
        console.log('\n   Other available campaigns:')
        for (const c of campaignData.data) {
          if (c.id !== pick.id) console.log(`   ${c.id}  ${c.name} [${c.status}]`)
        }
        console.log('   Update META_CAMPAIGN_ID in .env.local if you want a different one.')
      }
    }
  } else {
    console.log(`ℹ️   META_CAMPAIGN_ID already set: ${env['META_CAMPAIGN_ID']}`)
  }

  console.log('\nDone. Review .env.local to confirm the values look right.')
}

main().catch((e) => { console.error(e); process.exit(1) })
