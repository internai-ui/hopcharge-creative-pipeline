'use client'

import { useState, useCallback } from 'react'
import type { PipelineIssue, AgentAction } from '@prisma/client'

const SEVERITY_COLORS: Record<string, string> = {
  info:     'bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  warning:  'bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  critical: 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300',
}

const STAGE_COLORS: Record<string, string> = {
  idea_generation: 'text-indigo-600 dark:text-indigo-400',
  trend_analysis:  'text-emerald-600 dark:text-emerald-400',
  production:      'text-amber-600 dark:text-amber-400',
  review:          'text-blue-600 dark:text-blue-400',
  publishing:      'text-purple-600 dark:text-purple-400',
  analytics:       'text-cyan-600 dark:text-cyan-400',
  feedback_loop:   'text-rose-600 dark:text-rose-400',
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  )
}

function ChevronUp() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

interface EvaluationClientProps {
  initialIssues: PipelineIssue[]
  initialActions: AgentAction[]
  totalDecisions: number
  overriddenCount: number
}

export function EvaluationClient({ initialIssues, initialActions, totalDecisions, overriddenCount }: EvaluationClientProps) {
  const [issues, setIssues] = useState<PipelineIssue[]>(initialIssues)
  const [actions] = useState<AgentAction[]>(initialActions)
  const [narrative, setNarrative] = useState('')
  const [evaluating, setEvaluating] = useState(false)
  const [showResolved, setShowResolved] = useState(false)

  const overrideRate = totalDecisions > 0 ? (overriddenCount / totalDecisions) * 100 : 0

  const handleResolve = useCallback(async (id: string) => {
    await fetch(`/api/pipeline/issues/${id}/resolve`, { method: 'PATCH' })
    setIssues((prev) => prev.map((i) => i.id === id ? { ...i, isResolved: true, resolvedAt: new Date() } : i))
  }, [])

  const handleEvaluate = useCallback(async () => {
    setEvaluating(true)
    try {
      const res = await fetch('/api/pipeline/evaluation')
      const data = await res.json()
      setNarrative(data.narrative)
    } finally {
      setEvaluating(false)
    }
  }, [])

  const activeIssues = issues.filter((i) => !i.isResolved)
  const resolvedIssues = issues.filter((i) => i.isResolved)

  const criticalIssues = activeIssues.filter((i) => i.severity === 'critical')
  const warningIssues = activeIssues.filter((i) => i.severity === 'warning')
  const infoIssues = activeIssues.filter((i) => i.severity === 'info')

  const metricCards = [
    { label: 'Total Decisions', value: totalDecisions },
    { label: 'Override Rate', value: `${overrideRate.toFixed(1)}%` },
    { label: 'Overridden', value: overriddenCount },
    { label: 'Autonomous', value: totalDecisions - overriddenCount },
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 animate-page">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Pipeline Evaluation</h1>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Pipeline Issues</h2>
          <span className="text-sm text-gray-400 dark:text-zinc-500">{activeIssues.length} active</span>
        </div>

        {activeIssues.length === 0 && (
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-8 text-center text-gray-400 dark:text-zinc-500">
            No active issues. Pipeline is healthy.
          </div>
        )}

        {[
          { label: 'Critical', issues: criticalIssues },
          { label: 'Warning', issues: warningIssues },
          { label: 'Info', issues: infoIssues },
        ].map(({ label, issues: group }) =>
          group.length > 0 ? (
            <div key={label} className="space-y-2">
              <h3 className="text-xs font-medium text-gray-400 dark:text-zinc-500 uppercase tracking-wide">{label}</h3>
              {group.map((issue) => (
                <IssueRow key={issue.id} issue={issue} onResolve={handleResolve} />
              ))}
            </div>
          ) : null
        )}

        {resolvedIssues.length > 0 && (
          <div>
            <button
              onClick={() => setShowResolved(!showResolved)}
              className="inline-flex items-center gap-1.5 text-sm text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 transition-colors"
            >
              {showResolved ? <ChevronUp /> : <ChevronDown />}
              {resolvedIssues.length} resolved issues
            </button>
            {showResolved && (
              <div className="mt-2 space-y-2 opacity-60">
                {resolvedIssues.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} onResolve={() => {}} resolved />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white">Agent vs Human</h2>

        <div className="grid grid-cols-4 gap-4">
          {metricCards.map((card) => (
            <div key={card.label} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-zinc-500 mb-1">{card.label}</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-gray-900 dark:text-white">AI Evaluation Report</h3>
            <button
              onClick={handleEvaluate}
              disabled={evaluating}
              className="text-sm bg-indigo-600 hover:bg-indigo-500 active:scale-[0.97] disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-all duration-150"
            >
              {evaluating ? 'Generating...' : 'Generate report'}
            </button>
          </div>
          {narrative ? (
            <p className="text-sm text-gray-700 dark:text-zinc-300 leading-relaxed">{narrative}</p>
          ) : (
            <p className="text-sm text-gray-400 dark:text-zinc-600">
              Click &quot;Generate report&quot; to get Claude&apos;s evaluation of the pipeline&apos;s performance.
            </p>
          )}
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-zinc-800">
            <h3 className="font-medium text-gray-900 dark:text-white">Agent Actions</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900">
                {['Action', 'Rationale', 'Overridden?', 'Outcome', 'When'].map((h) => (
                  <th key={h} className="text-left text-xs text-gray-500 dark:text-zinc-500 font-medium px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {actions.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 dark:text-zinc-500">No agent actions yet</td></tr>
              )}
              {actions.map((action) => (
                <tr key={action.id} className="border-b border-gray-100 dark:border-zinc-800/50 hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 rounded">
                      {action.actionType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-zinc-400 text-xs max-w-xs">
                    <p className="line-clamp-2">{action.decisionRationale}</p>
                  </td>
                  <td className="px-4 py-3">
                    {action.humanOverridden ? (
                      <div>
                        <span className="text-xs text-amber-600 dark:text-amber-400">Yes</span>
                        {action.humanOverrideReason && (
                          <p className="text-xs text-gray-400 dark:text-zinc-600 mt-0.5">{action.humanOverrideReason}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 dark:text-zinc-600">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {action.outcome ? (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${action.outcome === 'winning_creative' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                        {action.outcome}
                      </span>
                    ) : <span className="text-gray-300 dark:text-zinc-600 text-xs">-</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 dark:text-zinc-500">
                    {new Date(action.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function IssueRow({ issue, onResolve, resolved = false }: { issue: PipelineIssue; onResolve: (id: string) => void; resolved?: boolean }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4 flex items-start gap-3 hover:border-gray-300 dark:hover:border-zinc-700 transition-colors">
      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 mt-0.5 ${SEVERITY_COLORS[issue.severity] ?? 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>
        {issue.severity}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-medium ${STAGE_COLORS[issue.stage] ?? 'text-gray-500 dark:text-zinc-400'}`}>{issue.stage}</span>
          <span className="text-xs text-gray-400 dark:text-zinc-600">{new Date(issue.createdAt).toLocaleString()}</span>
        </div>
        <p className="text-sm text-gray-700 dark:text-zinc-300">{issue.description}</p>
        {issue.relatedEntityId && (
          <p className="text-xs text-gray-400 dark:text-zinc-600 mt-1 font-mono">{issue.relatedEntityId.slice(0, 12)}...</p>
        )}
      </div>
      {!resolved && (
        <button
          onClick={() => onResolve(issue.id)}
          className="text-xs text-gray-400 dark:text-zinc-500 hover:text-emerald-600 dark:hover:text-emerald-400 shrink-0 transition-colors"
        >
          Resolve
        </button>
      )}
      {resolved && (
        <span className="text-xs text-emerald-600 dark:text-emerald-600 shrink-0 flex items-center gap-1">
          <CheckIcon /> Resolved
        </span>
      )}
    </div>
  )
}
