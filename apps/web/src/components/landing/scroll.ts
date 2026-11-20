import type { MouseEvent } from 'react'

// Smooth-scroll to a section on the landing page (falls back to a normal jump).
export function scrollToSection(id: string) {
  return (e: MouseEvent) => {
    const el = document.getElementById(id)
    if (!el) return
    e.preventDefault()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    history.replaceState(null, '', `#${id}`)
  }
}

// CP001's id: the same in supabase/seed.sql and in the mocks.
export const CP001_PATH = '/projects/10000000-0000-4000-8000-000000000001'
