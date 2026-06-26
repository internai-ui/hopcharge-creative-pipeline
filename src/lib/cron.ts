// Pure cron helpers shared by the automation API and UI. No server-only imports
// so this is safe to use from client components.

export interface CronPreset {
  label: string
  cron: string
}

// Common cadences offered in the schedule picker. "Custom" is handled separately
// by the UI for anything not in this list.
export const CRON_PRESETS: CronPreset[] = [
  { label: 'Every minute', cron: '*/1 * * * *' },
  { label: 'Every 5 minutes', cron: '*/5 * * * *' },
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { label: 'Every 30 minutes', cron: '*/30 * * * *' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Every 2 hours', cron: '0 */2 * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Every 12 hours', cron: '0 */12 * * *' },
  { label: 'Daily at 06:00', cron: '0 6 * * *' },
  { label: 'Daily at 08:00', cron: '0 8 * * *' },
]

// One cron field: *, a number, a range, a step, a list, or any combination.
const FIELD = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/

// Lenient validation of a standard 5-field cron expression. pg-boss / cron-parser
// does the authoritative parse at schedule time; this just catches obvious typos
// before we persist them.
export function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false
  return parts.every((p) => FIELD.test(p))
}

const pad = (n: number) => String(n).padStart(2, '0')

// Best-effort human-readable label for the cron cadences we actually use. Falls
// back to the raw expression for anything exotic.
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron
  const [min, hour, dom, mon, dow] = parts

  if (dom === '*' && mon === '*' && dow === '*') {
    if (hour === '*') {
      if (min === '*' || min === '*/1') return 'every minute'
      const stepped = min.match(/^\*\/(\d+)$/)
      if (stepped) return `every ${stepped[1]} minutes`
      if (/^\d+$/.test(min)) return `hourly at :${pad(+min)}`
    }
    const hourStep = hour.match(/^\*\/(\d+)$/)
    if (hourStep && /^\d+$/.test(min)) {
      const n = +hourStep[1]
      return n === 1 ? 'every hour' : `every ${n} hours`
    }
    if (/^\d+$/.test(hour) && /^\d+$/.test(min)) {
      return `daily at ${pad(+hour)}:${pad(+min)}`
    }
  }
  return cron
}
