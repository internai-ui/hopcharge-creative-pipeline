'use client'

// Segment-level error boundary for every /(app) page. Without it, a failure in a
// Server Component (e.g. the database being unreachable) bubbles to Next's raw
// "This page couldn't load" screen. This renders a clean, on-brand fallback inside
// the app shell instead, with a retry that re-runs the failed render.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-bg px-6">
      <div className="w-full max-w-md rounded-sm border border-brand-border bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-surface text-2xl">
          ⚠️
        </div>
        <h1 className="mb-2 text-lg font-semibold text-brand">Couldn&rsquo;t load this page</h1>
        <p className="mb-6 text-sm text-brand-muted">
          We couldn&rsquo;t reach the data service just now. This is usually temporary &mdash;
          try again in a moment.
        </p>
        <button onClick={reset} className="btn-primary">
          Try again
        </button>
        {error?.digest && (
          <p className="mt-6 text-xs text-brand-muted/70">Reference: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
