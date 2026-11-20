import type { Milestone, Project } from '../types'
import { useProjects } from './queries'

// There is no GET /milestones/:id, so look the milestone up through the projects.
// Needs `milestones` on each project (REQUESTED from P2).
export function useMilestone(milestoneId: string) {
  const projects = useProjects()
  let milestone: Milestone | undefined
  let project: Project | undefined
  for (const p of projects.data ?? []) {
    const found = p.milestones?.find((m) => m.id === milestoneId)
    if (found) {
      milestone = found
      project = p
    }
  }
  return { milestone, project, isPending: projects.isPending, error: projects.error }
}
