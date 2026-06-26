interface ErrorBannerProps {
  title: string
  message: string
  onDismiss: () => void
}

// Dismissible error banner used for page-level failures (generation, import, …).
export function ErrorBanner({ title, message, onDismiss }: ErrorBannerProps) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-red-700">{title}</p>
        <p className="text-xs text-red-600 mt-0.5">{message}</p>
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
