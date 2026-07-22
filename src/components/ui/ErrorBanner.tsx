interface ErrorBannerProps {
  title: string
  message: string
  // Optional concrete next steps to resolve the error, rendered as a checklist.
  actions?: string[]
  onDismiss: () => void
}

// Dismissible error banner used for page-level failures (generation, import, publish…).
// When `actions` are given it also shows a "How to fix it" checklist so the user always
// has a clear next step, not just a reason.
export function ErrorBanner({ title, message, actions, onDismiss }: ErrorBannerProps) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-red-700">{title}</p>
        <p className="text-xs text-red-600 mt-0.5">{message}</p>
        {actions && actions.length > 0 && (
          <div className="mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700/80">How to fix it</p>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              {actions.map((a, i) => (
                <li key={i} className="text-xs text-red-600">{a}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="text-red-400 hover:text-red-600 text-xs shrink-0"
      >
        Dismiss
      </button>
    </div>
  )
}
