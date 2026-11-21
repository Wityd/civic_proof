import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom'

// Shown instead of a blank screen if a page crashes while rendering.
export function ErrorPage() {
  const error = useRouteError()
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : null

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-card bg-white p-8 text-center shadow-card">
        <p className="text-lg font-semibold text-slate-900">Something went wrong on this page</p>
        <p className="mt-2 text-sm text-slate-500">
          Try reloading. If it keeps happening, go back to the projects and try again.
        </p>
        {detail && <p className="mt-3 rounded-xl bg-slate-50 p-2 font-mono text-xs break-words text-slate-500">{detail}</p>}
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Reload the page
          </button>
          <Link
            to="/projects"
            reloadDocument
            className="rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Go to projects
          </Link>
        </div>
      </div>
    </div>
  )
}
