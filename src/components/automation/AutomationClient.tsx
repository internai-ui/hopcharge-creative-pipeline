'use client'

import { useState } from 'react'
import { CRON_PRESETS, describeCron, isValidCron } from '@/lib/cron'

type JobView = {
  name: string
  label: string
  description: string
  category: string
  cron: string
  defaultCron: string
  enabled: boolean
  scheduled: boolean
}

function Switch({
  checked,
  disabled,
  onChange,
  size = 'md',
}: {
  checked: boolean
  disabled?: boolean
  onChange: () => void
  size?: 'md' | 'lg'
}) {
  const dims = size === 'lg' ? { w: 'w-12', h: 'h-7', k: 'h-6 w-6', t: 'translate-x-5' } : { w: 'w-10', h: 'h-6', k: 'h-5 w-5', t: 'translate-x-4' }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex ${dims.w} ${dims.h} shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-brand' : 'bg-brand-border'
      }`}
    >
      <span
        className={`inline-block ${dims.k} transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? dims.t : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

const CUSTOM = '__custom__'

// Inline editor for one job's cron schedule: a preset dropdown plus a custom-cron
// field. Calls onSave with the chosen cron ('' clears back to the default).
function ScheduleEditor({
  job,
  saving,
  onSave,
  onCancel,
}: {
  job: JobView
  saving: boolean
  onSave: (cron: string) => void
  onCancel: () => void
}) {
  const presetMatch = CRON_PRESETS.find((p) => p.cron === job.cron)
  const [mode, setMode] = useState<string>(presetMatch ? presetMatch.cron : CUSTOM)
  const [custom, setCustom] = useState<string>(job.cron)

  const cron = mode === CUSTOM ? custom.trim() : mode
  const valid = isValidCron(cron)
  const isOverridden = job.cron !== job.defaultCron

  return (
    <div className="mt-3 rounded-lg border border-brand-border bg-brand-bg/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-brand-dark">Run</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="text-xs rounded-md border border-brand-border bg-white px-2 py-1.5 text-brand-dark"
        >
          {CRON_PRESETS.map((p) => (
            <option key={p.cron} value={p.cron}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>

        {mode === CUSTOM && (
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="*/5 * * * *"
            spellCheck={false}
            className={`text-xs font-mono rounded-md border bg-white px-2 py-1.5 text-brand-dark w-40 ${
              custom.trim() && !valid ? 'border-red-400' : 'border-brand-border'
            }`}
          />
        )}

        <span className="text-xs text-brand-muted">
          {valid ? describeCron(cron) : 'enter a 5-field cron'}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!valid || saving}
          onClick={() => onSave(cron)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-brand text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save schedule'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-brand-border text-brand-dark hover:bg-white transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        {isOverridden && (
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave('')}
            className="text-xs text-brand-muted hover:text-brand-dark transition-colors disabled:opacity-50"
          >
            Reset to default ({describeCron(job.defaultCron)})
          </button>
        )}
      </div>
    </div>
  )
}

export function AutomationClient({
  initialMaster,
  initialJobs,
}: {
  initialMaster: boolean
  initialJobs: JobView[]
}) {
  const [master, setMaster] = useState(initialMaster)
  const [jobs, setJobs] = useState<JobView[]>(initialJobs)
  const [pending, setPending] = useState<string | null>(null) // which control is saving
  const [running, setRunning] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null) // which job's schedule is open
  const [msg, setMsg] = useState('')

  const activeCount = jobs.filter((j) => j.scheduled).length

  async function patch(body: Record<string, unknown>, key: string): Promise<boolean> {
    setPending(key)
    setMsg('')
    try {
      const res = await fetch('/api/automation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.details || data.error || 'Update failed')
      setMaster(data.masterEnabled)
      setJobs(data.jobs)
      return true
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Update failed')
      return false
    } finally {
      setPending(null)
    }
  }

  const toggleMaster = () => patch({ masterEnabled: !master }, 'master')
  const toggleJob = (name: string, enabled: boolean) => patch({ jobs: { [name]: !enabled } }, name)

  async function saveSchedule(name: string, cron: string) {
    const ok = await patch({ schedules: { [name]: cron } }, `sched:${name}`)
    if (ok) {
      setEditing(null)
      setMsg(`Schedule updated for "${name}".`)
    }
  }

  async function runNow(name: string) {
    setRunning(name)
    setMsg('')
    try {
      const res = await fetch('/api/automation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.details || data.error || 'Run failed')
      setMsg(`Ran "${name}" successfully at ${new Date().toLocaleTimeString()}`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-brand-dark">Automation</h1>
        <p className="text-sm text-brand-muted mt-1">
          Control the background jobs that run the pipeline on a schedule. Turning the master switch on
          starts the selected jobs immediately - no restart needed.
        </p>
      </header>

      {/* Master switch */}
      <div className={`rounded-xl border p-5 mb-6 transition-colors ${master ? 'border-brand/40 bg-brand-surface' : 'border-brand-border bg-white'}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-brand-dark">Job automation</h2>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${master ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-bg text-brand-muted'}`}>
                {master ? `ON · ${activeCount} active` : 'OFF'}
              </span>
            </div>
            <p className="text-sm text-brand-muted mt-1">
              {master
                ? 'Enabled jobs below are scheduled and running.'
                : 'Everything runs manually. Flip this on to let the scheduler take over.'}
            </p>
          </div>
          <Switch checked={master} disabled={pending === 'master'} onChange={toggleMaster} size="lg" />
        </div>
      </div>

      {/* Per-job configuration */}
      <div className="rounded-xl border border-brand-border bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-brand-border">
          <h2 className="text-sm font-semibold text-brand-dark">What gets automated</h2>
          <p className="text-xs text-brand-muted mt-0.5">
            Toggle each job on or off, and set how often it runs.
          </p>
        </div>

        <ul>
          {jobs.map((job) => {
            const live = master && job.enabled
            const isEditing = editing === job.name
            return (
              <li key={job.name} className="flex items-start gap-4 px-5 py-4 border-b border-brand-border last:border-0">
                <div className="pt-0.5">
                  <Switch
                    checked={job.enabled}
                    disabled={pending === job.name}
                    onChange={() => toggleJob(job.name, job.enabled)}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-brand-dark">{job.label}</span>
                    <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-brand-bg text-brand-muted">
                      {job.category}
                    </span>
                    <span className={`inline-flex items-center gap-1 text-[11px] ${live ? 'text-emerald-600' : 'text-brand-muted'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-brand-border'}`} />
                      {live ? `running ${describeCron(job.cron)}` : master ? 'paused' : 'manual only'}
                    </span>
                  </div>
                  <p className="text-sm text-brand-muted mt-1">{job.description}</p>

                  {/* Schedule row: friendly cadence + raw cron, with an edit toggle. */}
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] text-brand-muted">
                    <span>
                      Runs <span className="text-brand-dark font-medium">{describeCron(job.cron)}</span>
                    </span>
                    <code className="text-brand-muted/80">{job.cron}</code>
                    {job.cron !== job.defaultCron && (
                      <span className="text-[10px] uppercase tracking-wide px-1 py-0.5 rounded bg-amber-100 text-amber-700">
                        custom
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditing(isEditing ? null : job.name)}
                      className="text-brand hover:underline font-medium"
                    >
                      {isEditing ? 'Close' : 'Edit'}
                    </button>
                  </div>

                  {isEditing && (
                    <ScheduleEditor
                      job={job}
                      saving={pending === `sched:${job.name}`}
                      onSave={(cron) => saveSchedule(job.name, cron)}
                      onCancel={() => setEditing(null)}
                    />
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => runNow(job.name)}
                  disabled={running === job.name}
                  className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-brand-border text-brand-dark hover:bg-brand-bg transition-colors disabled:opacity-50"
                >
                  {running === job.name ? 'Running…' : 'Run now'}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {msg && (
        <p className="text-sm mt-4 text-brand-muted" role="status">
          {msg}
        </p>
      )}

      <p className="text-xs text-brand-muted mt-6 leading-relaxed">
        Automation handles <span className="font-medium text-brand-dark">timing only</span>. It decides
        when each job runs, nothing more. It never spends generation credits, approves a creative, or
        publishes an ad; selecting ideas, approving creatives, and publishing always stay manual.{' '}
        <span className="font-medium text-brand-dark">Run now</span> triggers one immediate run, ignoring
        the schedule.
      </p>
    </div>
  )
}
