'use client'

import { useState } from 'react'

interface TrendDotProps {
  score: number | null
  warning: string | null
}

export function TrendDot({ score, warning }: TrendDotProps) {
  const [showTooltip, setShowTooltip] = useState(false)

  const color =
    score === null ? 'bg-gray-400' :
    score >= 0.6 ? 'bg-emerald-500' :
    score >= 0.3 ? 'bg-amber-500' :
    'bg-red-500'

  const pulse = score !== null && score >= 0.6 ? 'animate-pulse-soft' : ''

  const label =
    score === null ? 'Unscored' :
    score >= 0.6 ? `On-trend (${Math.round(score * 100)})` :
    score >= 0.3 ? `Watch (${Math.round(score * 100)})` :
    `Stale (${Math.round(score * 100)})`

  const textColor =
    score !== null && score < 0.3 ? 'text-red-500' :
    score !== null && score < 0.6 ? 'text-amber-600' :
    'text-brand-muted'

  return (
    <div
      className="relative inline-flex items-center gap-1.5"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className={`w-2 h-2 rounded-full ${color} ${pulse} shrink-0`} />
      <span className={`text-xs ${textColor}`}>{label}</span>
      {showTooltip && warning && (
        <div className="absolute bottom-full left-0 mb-1.5 w-56 p-2.5 bg-white border border-brand-border rounded-lg text-xs text-brand-dark z-50 shadow-lg">
          {warning}
        </div>
      )}
    </div>
  )
}
