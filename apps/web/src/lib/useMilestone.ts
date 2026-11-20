import { useQueries, useQuery } from '@tanstack/react-query'
import type { Milestone, Project, ProjectDetail } from '../types'
import { api } from './api'

// There is no GET /milestones/:id, so look the milestone up through the projects.
// TODO(P2): replace with GET /milestones/:id if the API adds it.
export function useMilestone(milestoneId: string) {
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') })
  const details = useQueries({
    queries: (projects.data ?? []).map((p) => ({
      queryKey: ['project', p.id],
      queryFn: () => api.get<ProjectDetail>(`/projects/${p.id}`),
    })),
  })

  let milestone: Milestone | undefined
  let project: Project | undefined
  for (const d of details) {
    const found = d.data?.milestones.find((m) => m.id === milestoneId)
    if (found) {
      milestone = found
      project = d.data!.project
    }
  }

  return {
    milestone,
    project,
    isPending: projects.isPending || details.some((d) => d.isPending),
    error: projects.error ?? details.find((d) => d.error)?.error ?? null,
  }
}
