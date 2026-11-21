import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { SignInDialog } from '../components/SignInDialog'
import { api, ApiError, USE_MOCKS } from '../lib/api'
import { demoEmail, hasSession, isRole, ROLES, signOut } from '../lib/auth'
import { getViewAsId, setViewAsId } from '../lib/viewAs'
import { mockUsers } from '../mocks'
import type { DemoUser, Me, Role } from '../types'

// Mocks: "View as" picks one of the mock users.
// Real API: "View as" picks a role; the seeded demo account for it is signed in with
// Supabase (password typed once per browser), and the user comes from GET /me.

interface ViewAsValue {
  user: DemoUser | null
  users: DemoUser[]
  selectedId: string | null // what the switcher shows (mock user id, or role name in real mode)
  setUserId: (id: string | null) => void
}

const ViewAsContext = createContext<ViewAsValue | null>(null)

// In real mode the switcher lists roles; the id is the role name.
const REAL_USERS: DemoUser[] = ROLES.map((role) => ({
  id: role,
  display_name: '', // the switcher shows just the role until signed in
  role,
  title: demoEmail(role),
  supplier_ids: [],
}))

export function ViewAsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(() => getViewAsId())
  const [askRole, setAskRole] = useState<Role | null>(null)

  const select = useCallback(
    (id: string | null) => {
      setViewAsId(id)
      setSelectedId(id)
      // Different users see different data, so refetch everything.
      queryClient.invalidateQueries()
    },
    [queryClient],
  )

  const setUserId = useCallback(
    async (id: string | null) => {
      if (USE_MOCKS || !id) return select(id)
      if (!isRole(id)) return
      if (await hasSession(id)) select(id)
      else setAskRole(id)
    },
    [select],
  )

  // Real mode: who am I?
  const activeRole = !USE_MOCKS && isRole(selectedId) ? selectedId : null
  const me = useQuery({
    queryKey: ['me', activeRole],
    queryFn: () => api.get<Me>('/me'),
    enabled: !!activeRole,
    retry: false,
  })

  // Session gone or expired → drop back to public and ask for the password again.
  useEffect(() => {
    if (activeRole && me.error instanceof ApiError && me.error.code === 'UNAUTHENTICATED') {
      signOut(activeRole).finally(() => {
        select(null)
        setAskRole(activeRole)
      })
    }
  }, [activeRole, me.error, select])

  let user: DemoUser | null = null
  if (USE_MOCKS) {
    user = mockUsers.find((u) => u.id === selectedId) ?? null
  } else if (activeRole && me.data) {
    user = {
      id: me.data.id,
      display_name: me.data.display_name,
      role: me.data.role,
      title: demoEmail(me.data.role),
      supplier_ids: me.data.supplier_ids ?? [],
    }
  }

  const users = USE_MOCKS ? mockUsers : REAL_USERS

  return (
    <ViewAsContext.Provider value={{ user, users, selectedId, setUserId }}>
      {children}
      {askRole && (
        <SignInDialog
          role={askRole}
          onCancel={() => setAskRole(null)}
          onDone={() => {
            select(askRole)
            setAskRole(null)
          }}
        />
      )}
    </ViewAsContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useViewAs() {
  const ctx = useContext(ViewAsContext)
  if (!ctx) throw new Error('useViewAs must be used inside ViewAsProvider')
  return ctx
}
