import type { SkillRecord } from "./types"

export function formatSkillsSection(skills: SkillRecord[]): string[] {
  if (skills.length === 0) return []

  const lines: string[] = ["### Memento Skills", ""]
  for (const skill of skills) {
    const label = skill.approved ? `[${skill.category}]` : `[Proposed] [${skill.category}]`
    lines.push(`- ${label} ${skill.content}`)
  }
  lines.push("")
  return lines
}
