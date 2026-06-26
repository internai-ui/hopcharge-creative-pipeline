'use client'

import { useState, useCallback } from 'react'
import type { PipelineIssue, AgentAction } from '@prisma/client'

const SEVERITY_COLORS: Record<string, string> = {
  info:     'bg-blue-50 text-blue-700',
  warning:  'bg-amber-50 text-amber-700',
  critical: 'bg-red-50 text-red-700',
}

const STAGE_COLORS: Record<string, string> = {
  idea_generation: 'text-brand',
  trend_analysis:  'text-emerald-600',
  production:      'text-amber-600',
  review:          'text-blue-600',
  publishing:      'text-purple-600',
  analytics:       'text-cyan-600',
  feedback_loop:   'text-rose-600',
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
  const [showAllActions, setShowAllActions] = useState(false)
  const [showIssues, setShowIssues] = useState(false)

  const ACTIONS_PREVIEW = 5
  const visibleActions = showAllActions ? actions : actions.slice(0, ACTIONS_PREVIEW)

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
      <h1 className="text-2xl font-semibold text-brand-dark">Pipeline Evaluation</h1>

      {/* ── Agent vs Human ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-brand-dark">Agent vs Human</h2>

        <div className="grid grid-cols-4 gap-4">
          {metricCards.map((card) => (
            <div key={card.label} className="bg-white border border-brand-border rounded-xl p-4 shadow-sm">
              <p className="text-xs text-brand-muted mb-1">{card.label}</p>
              <p className="text-2xl font-semibold text-brand-dark">{card.value}</p>
            </div>
          ))}
        </div>

        {/* AI report */}
        <div className="bg-white border border-brand-border rounded-xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-brand-dark">AI Evaluation Report</h3>
            <button
              onClick={handleEvaluate}
              disabled={evaluating}
              className="text-sm bg-brand hover:bg-brand-dark active:scale-[0.97] disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-all duration-200"
            >
              {evaluating ? 'Generating...' : 'Generate report'}
            </button>
          </div>
          {narrative ? (
            <p className="text-sm text-brand-dark leading-relaxed whitespace-pre-line">{narrative}</p>
          ) : (
            <p className="text-sm text-brand-muted">
              Click &quot;Generate report&quot; to get a full analysis: pipeline health, why certain ads outperform others, and concrete recommendations.
            </p>
          )}
        </div>

        {/* Agent actions - preview + show more */}
        <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-brand-border flex items-center justify-between">
            <h3 className="font-medium text-brand-dark">Agent Actions</h3>
            <span className="text-xs text-brand-muted">{actions.length} total</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-border bg-brand-bg">
                {['Action', 'Rationale', 'Overridden?', 'Outcome', 'When'].map((h) => (
                  <th key={h} className="text-left text-xs text-brand-muted font-medium px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {actions.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-brand-muted">No agent actions yet</td></tr>
              )}
              {visibleActions.map((action, idx) => (
                <tr
                  key={action.id}
                  className={`border-b border-brand-border hover:bg-brand-bg transition-colors ${showAllActions && idx >= ACTIONS_PREVIEW ? 'animate-reveal' : ''}`}
                  style={showAllActions && idx >= ACTIONS_PREVIEW ? { animationDelay: `${(idx - ACTIONS_PREVIEW) * 30}ms` } : undefined}
                >
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-brand bg-brand-surface px-1.5 py-0.5 rounded">
                      {action.actionType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-brand-muted text-xs max-w-xs">
                    <p className="line-clamp-2">{action.decisionRationale}</p>
                  </td>
                  <td className="px-4 py-3">
                    {action.humanOverridden ? (
                      <div>
                        <span className="text-xs text-amber-600">Yes</span>
                        {action.humanOverrideReason && (
                          <p className="text-xs text-brand-muted mt-0.5">{action.humanOverrideReason}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {action.outcome ? (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${action.outcome === 'winning_creative' ? 'bg-emerald-50 text-emerald-700' : 'bg-brand-surface text-brand-muted'}`}>
                        {action.outcome}
                      </span>
                    ) : <span className="text-gray-300 text-xs">-</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-brand-muted">
                    {new Date(action.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {actions.length > ACTIONS_PREVIEW && (
            <button
              onClick={() => setShowAllActions(v => !v)}
              className="w-full flex items-center justify-center gap-1.5 py-3 text-sm text-brand-muted hover:text-brand-dark hover:bg-brand-bg transition-colors border-t border-brand-border"
            >
              {showAllActions ? <ChevronUp /> : <ChevronDown />}
              {showAllActions ? 'Show less' : `Show ${actions.length - ACTIONS_PREVIEW} more actions`}
            </button>
          )}
        </div>
      </section>

      {/* ── Pipeline Issues - collapsed at bottom ── */}
      <section className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
        <button
          onClick={() => setShowIssues(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-brand-bg transition-colors"
        >
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-brand-dark">Pipeline Issues</h2>
            {criticalIssues.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">
                {criticalIssues.length} critical
              </span>
            )}
            {warningIssues.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium">
                {warningIssues.length} warning
              </span>
            )}
            {activeIssues.length === 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-medium">healthy</span>
            )}
          </div>
          <span className={`text-brand-muted chevron-rotate ${showIssues ? 'open' : ''}`}><ChevronDown /></span>
        </button>

        <div className={`collapsible ${showIssues ? 'open' : ''}`}>
          <div className="collapsible-inner">
          <div className="px-5 pb-5 space-y-4 border-t border-brand-border pt-4">
            {activeIssues.length === 0 && (
              <p className="text-sm text-brand-muted text-center py-4">No active issues. Pipeline is healthy.</p>
            )}

            {[
              { label: 'Critical', issues: criticalIssues },
              { label: 'Warning', issues: warningIssues },
              { label: 'Info', issues: infoIssues },
            ].map(({ label, issues: group }) =>
              group.length > 0 ? (
                <div key={label} className="space-y-2">
                  <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide">{label}</h3>
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
                  className="inline-flex items-center gap-1.5 text-sm text-brand-muted hover:text-brand-dark transition-colors"
                >
                  <span className={`chevron-rotate ${showResolved ? 'open' : ''}`}><ChevronDown /></span>
                  {resolvedIssues.length} resolved issues
                </button>
                <div className={`collapsible ${showResolved ? 'open' : ''}`}>
                  <div className="collapsible-inner">
                    <div className="mt-2 space-y-2 opacity-60">
                      {resolvedIssues.map((issue) => (
                        <IssueRow key={issue.id} issue={issue} onResolve={() => {}} resolved />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function IssueRow({ issue, onResolve, resolved = false }: { issue: PipelineIssue; onResolve: (id: string) => void; resolved?: boolean }) {
  return (
    <div className="bg-white border border-brand-border rounded-xl p-4 flex items-start gap-3 hover:border-brand-divider transition-colors">
      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 mt-0.5 ${SEVERITY_COLORS[issue.severity] ?? 'bg-brand-surface text-brand-muted'}`}>
        {issue.severity}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-medium ${STAGE_COLORS[issue.stage] ?? 'text-brand-muted'}`}>{issue.stage}</span>
          <span className="text-xs text-brand-muted">{new Date(issue.createdAt).toLocaleString()}</span>
        </div>
        <p className="text-sm text-brand-dark">{issue.description}</p>
        {issue.relatedEntityId && (
          <p className="text-xs text-brand-muted mt-1 font-mono">{issue.relatedEntityId.slice(0, 12)}...</p>
        )}
      </div>
      {!resolved && (
        <button
          onClick={() => onResolve(issue.id)}
          className="text-xs text-brand-muted hover:text-emerald-600 shrink-0 transition-colors"
        >
          Resolve
        </button>
      )}
      {resolved && (
        <span className="text-xs text-emerald-600 shrink-0 flex items-center gap-1">
          <CheckIcon /> Resolved
        </span>
      )}
    </div>
  )
}
