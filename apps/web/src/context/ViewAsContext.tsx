import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { getViewAsId, setViewAsId } from '../lib/viewAs'
import { mockUsers } from '../mocks'
import type { User } from '../types'

// For now the switcher uses the mock users. Later: sign in the seeded
// Supabase demo users here and pass the token to setAuthToken().

interface ViewAsValue {
  user: User | null
  users: User[]
  setUserId: (id: string | null) => void
}

const ViewAsContext = createContext<ViewAsValue | null>(null)

export function ViewAsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [userId, setUserIdState] = useState<string | null>(() => getViewAsId())
  const user = mockUsers.find((u) => u.id === userId) ?? null

  const setUserId = useCallback(
    (id: string | null) => {
      setViewAsId(id)
      setUserIdState(id)
      // Different users see different data, so refetch everything.
      queryClient.invalidateQueries()
    },
    [queryClient],
  )

  return (
    <ViewAsContext.Provider value={{ user, users: mockUsers, setUserId }}>
      {children}
    </ViewAsContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useViewAs() {
  const ctx = useContext(ViewAsContext)
  if (!ctx) throw new Error('useViewAs must be used inside ViewAsProvider')
  return ctx
}
