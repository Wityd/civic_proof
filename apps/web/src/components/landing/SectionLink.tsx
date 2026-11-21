import type { MouseEvent, ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { scrollToSection } from './scroll'

// Link to a landing-page section. On the landing page it smooth-scrolls; anywhere else
// (e.g. /team) it goes to "/#section" and the landing page scrolls there on load.
export function SectionLink({
  section,
  className,
  onClick,
  children,
}: {
  section: string
  className?: string
  onClick?: () => void
  children: ReactNode
}) {
  const { pathname } = useLocation()
  if (pathname !== '/') {
    return (
      <Link to={`/#${section}`} className={className} onClick={onClick}>
        {children}
      </Link>
    )
  }
  return (
    <a
      href={`#${section}`}
      className={className}
      onClick={(e: MouseEvent) => {
        scrollToSection(section)(e)
        onClick?.()
      }}
    >
      {children}
    </a>
  )
}
