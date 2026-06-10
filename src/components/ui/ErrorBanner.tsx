interface ErrorBannerProps {
  title: string
  message: string
  onDismiss: () => void
}

// Dismissible error banner used for page-level failures (generation, import, …).
export function ErrorBanner({ title, message, onDismiss }: ErrorBannerProps) {
  return (
    <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl px-4 py-3 flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-red-700 dark:text-red-400">{title}</p>
        <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">{message}</p>
      </div>
      <button
        onClick={onDismiss}
        className="text-red-400 hover:text-red-600 dark:hover:text-red-300 text-xs shrink-0"
      >
        Dismiss
      </button>
    </div>
  )
}
