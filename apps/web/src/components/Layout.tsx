import { Outlet } from 'react-router-dom'
import { DevBadge } from './DevBadge'
import { Header } from './Header'

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <DevBadge />
    </div>
  )
}
