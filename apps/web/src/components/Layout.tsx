import { Outlet } from 'react-router-dom'
import { USE_MOCKS } from '../lib/api'
import { Header } from './Header'

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="bg-slate-800 px-4 py-1 text-center text-xs text-slate-200">
        Fictional demo data: all names, places and amounts are made up.
        {USE_MOCKS && <span className="ml-2 rounded-full bg-amber-400 px-2 text-slate-900">Mock API</span>}
      </div>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
