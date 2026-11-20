// Shared queries, so pages reuse the same cached data.
import { useQuery } from '@tanstack/react-query'
import type { Project, Supplier } from '../types'
import { api } from './api'

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') })
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get<Project>(`/projects/${id}`),
    enabled: !!id,
  })
}

// GET /invoices rows only have supplier_id, so look names up here.
export function useSuppliers() {
  const query = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/suppliers') })
  const byId = new Map((query.data ?? []).map((s) => [s.id, s]))
  return { ...query, byId, nameOf: (id: string) => byId.get(id)?.name ?? 'Unknown supplier' }
}

// Project UUID → "CP001"
export function useProjectCodes() {
  const query = useProjects()
  const byId = new Map((query.data ?? []).map((p) => [p.id, p]))
  return { ...query, byId, codeOf: (id: string) => byId.get(id)?.code ?? '…' }
}
