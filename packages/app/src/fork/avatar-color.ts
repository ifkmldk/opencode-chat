import { createEffect } from "solid-js"

// fork: v1 gave every project without an icon a random avatar colour and saved it on the server, so
// projects can be told apart at a glance; v2 leaves them grey. The keys are v1's palette, which v2's
// getProjectAvatarVariant already maps (mint → cyan, lime → green), so both builds agree on a project.
export const AVATAR_COLORS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const

type Project = { id?: string; worktree: string; icon?: { color?: string; override?: string; url?: string } }

export function pickAvatarColor(used: ReadonlySet<string>, random = Math.random) {
  const free = AVATAR_COLORS.filter((color) => !used.has(color))
  const pool = free.length ? free : AVATAR_COLORS
  return pool[Math.floor(random() * pool.length)]!
}

export function assignProjectColors(input: {
  projects: () => readonly Project[]
  save: (project: Project & { id: string }, color: string) => Promise<unknown>
}) {
  const requested = new Set<string>()
  createEffect(() => {
    const projects = input.projects()
    const used = new Set(projects.flatMap((project) => (project.icon?.color ? [project.icon.color] : [])))
    for (const project of projects) {
      const id = project.id
      if (!id || requested.has(id)) continue
      if (project.icon?.color || project.icon?.override || project.icon?.url) continue
      const color = pickAvatarColor(used)
      used.add(color)
      requested.add(id)
      void input.save({ ...project, id }, color).catch(() => requested.delete(id))
    }
  })
}
