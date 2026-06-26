'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface Props {
  value: string         // "YYYY-MM-DDTHH:mm" or ""
  onChange: (v: string) => void
  placeholder?: string
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa']

function to12h(h24: number) { return { h: h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24, ampm: (h24 < 12 ? 'AM' : 'PM') as 'AM' | 'PM' } }
function to24h(h12: number, ampm: 'AM' | 'PM') { if (ampm === 'AM') return h12 === 12 ? 0 : h12; return h12 === 12 ? 12 : h12 + 12 }

function SpinnerCol({
  value, onUp, onDown, onCommit, isAmpm = false,
}: {
  value: string
  onUp: () => void
  onDown: () => void
  onCommit: (raw: string) => void
  isAmpm?: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const commit = (raw: string) => { onCommit(raw); setDraft(value) }

  return (
    <div className="flex-1 flex flex-col items-center border border-brand-border rounded-lg overflow-hidden">
      <button type="button" onClick={onUp}
        className="w-full py-1 hover:bg-brand-bg text-brand-muted hover:text-brand-dark transition-colors flex justify-center">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
      <input
        type={isAmpm ? 'text' : 'text'}
        inputMode={isAmpm ? 'text' : 'numeric'}
        value={draft}
        onChange={e => {
          const v = e.target.value
          setDraft(v)
          if (isAmpm) {
            if (v.toLowerCase().startsWith('p')) onCommit('PM')
            else if (v.toLowerCase().startsWith('a')) onCommit('AM')
          }
        }}
        onBlur={() => commit(draft)}
        onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); commit(draft) } }}
        className="w-full text-center text-sm font-semibold text-brand-dark py-1.5 focus:outline-none focus:bg-brand-bg transition-colors"
        style={{ minWidth: 0 }}
        onFocus={e => e.currentTarget.select()}
      />
      <button type="button" onClick={onDown}
        className="w-full py-1 hover:bg-brand-bg text-brand-muted hover:text-brand-dark transition-colors flex justify-center">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
  )
}

function CalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}
function ChevL() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
}
function ChevR() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
}

function parseParts(v: string) {
  if (!v) return { date: '', hour: 9, minute: 0 }
  const [datePart, timePart] = v.split('T')
  const [h, m] = (timePart ?? '09:00').split(':').map(Number)
  return { date: datePart ?? '', hour: h ?? 9, minute: m ?? 0 }
}

export function DateTimePicker({ value, onChange, placeholder = 'Select date and time' }: Props) {
  const { date: initDate, hour: initHour, minute: initMinute } = parseParts(value)
  const [open, setOpen]           = useState(false)
  const [selDate, setSelDate]     = useState(initDate)
  const [hour, setHour]           = useState(initHour)
  const [minute, setMinute]       = useState(initMinute)
  const [viewYear, setViewYear]   = useState(() => initDate ? new Date(initDate + 'T00:00').getFullYear() : new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(() => initDate ? new Date(initDate + 'T00:00').getMonth() : new Date().getMonth())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const { date, hour: h, minute: m } = parseParts(value)
    setSelDate(date); setHour(h); setMinute(m)
  }, [value])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const emit = useCallback((date: string, h: number, m: number) => {
    if (!date) { onChange(''); return }
    onChange(`${date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`)
  }, [onChange])

  const selectDay = (dateStr: string) => { setSelDate(dateStr); emit(dateStr, hour, minute) }

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) } else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) } else setViewMonth(m => m + 1)
  }

  const { h: h12, ampm } = to12h(hour)

  // Spinner arrow handlers
  const spinHourUp   = () => { const h24 = to24h(h12 === 12 ? 1 : h12 + 1, ampm); setHour(h24); emit(selDate, h24, minute) }
  const spinHourDown = () => { const h24 = to24h(h12 === 1 ? 12 : h12 - 1, ampm); setHour(h24); emit(selDate, h24, minute) }
  const spinMinUp    = () => { const m = (minute + 1) % 60; setMinute(m); emit(selDate, hour, m) }
  const spinMinDown  = () => { const m = (minute - 1 + 60) % 60; setMinute(m); emit(selDate, hour, m) }
  const spinAmpmFlip = () => { const h24 = to24h(h12, ampm === 'AM' ? 'PM' : 'AM'); setHour(h24); emit(selDate, h24, minute) }

  // Typed commit handlers — validate and clamp
  const commitHour = (raw: string) => {
    const n = parseInt(raw, 10)
    if (!isNaN(n)) {
      const clamped = Math.max(1, Math.min(12, n))
      const h24 = to24h(clamped, ampm)
      setHour(h24); emit(selDate, h24, minute)
    }
  }
  const commitMin = (raw: string) => {
    const n = parseInt(raw, 10)
    if (!isNaN(n)) {
      const clamped = Math.max(0, Math.min(59, n))
      setMinute(clamped); emit(selDate, hour, clamped)
    }
  }
  const commitAmpm = (raw: string) => {
    const upper = raw.toUpperCase()
    const next = upper === 'AM' || upper === 'PM' ? upper as 'AM' | 'PM' : null
    if (next) { const h24 = to24h(h12, next); setHour(h24); emit(selDate, h24, minute) }
  }

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const firstDow = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  const display = selDate
    ? `${new Date(selDate + 'T00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}, ${h12}:${String(minute).padStart(2,'0')} ${ampm}`
    : ''

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2 bg-white border rounded-lg text-sm text-left focus:outline-none transition-colors ${
          open ? 'border-brand ring-2 ring-brand/15' : 'border-brand-border hover:border-brand-divider'
        }`}
      >
        <span className="text-brand-muted shrink-0"><CalIcon /></span>
        <span className={`flex-1 ${display ? 'text-brand-dark' : 'text-brand-muted'}`}>{display || placeholder}</span>
        {display && (
          <span onClick={e => { e.stopPropagation(); setSelDate(''); onChange('') }}
            className="text-brand-muted hover:text-brand-dark transition-colors text-base leading-none ml-auto shrink-0">×</span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 bg-white border border-brand-border rounded-xl shadow-lg p-4 w-64">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevMonth} className="p-1 rounded-lg hover:bg-brand-bg text-brand-muted hover:text-brand-dark transition-colors"><ChevL /></button>
            <span className="text-sm font-medium text-brand-dark">{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} className="p-1 rounded-lg hover:bg-brand-bg text-brand-muted hover:text-brand-dark transition-colors"><ChevR /></button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-0.5">
            {DAYS.map(d => <div key={d} className="text-center text-[10px] font-medium text-brand-muted py-1">{d}</div>)}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDow }, (_, i) => <div key={`g${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day  = i + 1
              const dStr = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
              const isSel = dStr === selDate
              const isTod = dStr === todayStr
              return (
                <button key={day} type="button" onClick={() => selectDay(dStr)}
                  className={`h-8 w-full rounded-lg text-xs transition-colors ${isSel ? 'bg-brand text-white font-semibold' : isTod ? 'text-brand font-semibold hover:bg-brand-bg' : 'text-brand-dark hover:bg-brand-bg'}`}>
                  {day}
                </button>
              )
            })}
          </div>

          {/* Time — editable spinners */}
          <div className="mt-3 pt-3 border-t border-brand-border">
            <p className="text-xs text-brand-muted mb-2">Time</p>
            <div className="flex gap-1.5">
              <SpinnerCol value={String(h12)} onUp={spinHourUp} onDown={spinHourDown} onCommit={commitHour} />
              <SpinnerCol value={String(minute).padStart(2,'0')} onUp={spinMinUp} onDown={spinMinDown} onCommit={commitMin} />
              <SpinnerCol value={ampm} onUp={spinAmpmFlip} onDown={spinAmpmFlip} onCommit={commitAmpm} isAmpm />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
