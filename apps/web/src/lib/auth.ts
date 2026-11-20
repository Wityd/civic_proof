// Supabase JS is used ONLY to sign in the seeded demo users (CLAUDE.md rule 1).
// Each role gets its own client + saved session, so after typing a role's password
// once, switching "View as" to it is instant.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '../types'
import { getViewAsId } from './viewAs'

const URL = import.meta.env.VITE_SUPABASE_URL ?? ''
export const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const ROLES: Role[] = ['citizen', 'supplier', 'municipality', 'auditor']
export const isRole = (v: string | null): v is Role => !!v && (ROLES as string[]).includes(v)
export const demoEmail = (role: Role) => `${role}@demo.civicproof.test`

const clients = new Map<Role, SupabaseClient>()

export function authClient(role: Role): SupabaseClient {
  let client = clients.get(role)
  if (!client) {
    client = createClient(URL, ANON_KEY, {
      auth: {
        storageKey: `civicproof.auth.${role}`,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
    clients.set(role, client)
  }
  return client
}

export async function hasSession(role: Role): Promise<boolean> {
  const { data } = await authClient(role).auth.getSession()
  return !!data.session
}

export async function signIn(role: Role, password: string): Promise<void> {
  const { error } = await authClient(role).auth.signInWithPassword({ email: demoEmail(role), password })
  if (error) throw error
}

export async function signOut(role: Role): Promise<void> {
  await authClient(role).auth.signOut()
}

// Token for the role picked in "View as" (null when viewing as the public).
export async function getAccessToken(): Promise<string | null> {
  const role = getViewAsId()
  if (!isRole(role)) return null
  const { data } = await authClient(role).auth.getSession()
  return data.session?.access_token ?? null
}
