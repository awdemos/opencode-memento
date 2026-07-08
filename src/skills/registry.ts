import { access, readFile, writeFile } from "fs/promises"
import { join } from "path"
import type {
  SeededSkill,
  SkillCategory,
  SkillRecord,
  SkillRegistry,
  SkillSource,
} from "./types"

export const SKILL_REGISTRY_FILE = "memento-skills.json"
export const SKILL_SECTION_HEADING = "## Memento Skills"

const INSTRUCTION_FILE_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
]

export function makeSkillId(category: string, content: string): string {
  const base = content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
  return `${category.toLowerCase()}-${base}`
}

function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function now(): string {
  return new Date().toISOString()
}

export async function loadSkillRegistry(
  projectPath: string
): Promise<SkillRegistry> {
  const filePath = join(projectPath, ".opencode", SKILL_REGISTRY_FILE)
  try {
    const raw = JSON.parse(await readFile(filePath, "utf-8"))
    if (
      raw &&
      typeof raw === "object" &&
      raw.version === 1 &&
      typeof raw.projectPath === "string" &&
      Array.isArray(raw.skills)
    ) {
      return {
        version: 1,
        projectPath: raw.projectPath,
        skills: raw.skills,
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    ) {
      return {
        version: 1,
        projectPath,
        skills: [],
      }
    }
    console.warn(
      `[opencode-memento] Failed to load skill registry:`,
      error instanceof Error ? error.message : String(error)
    )
  }
  return {
    version: 1,
    projectPath,
    skills: [],
  }
}

export async function saveSkillRegistry(
  registry: SkillRegistry
): Promise<void> {
  const filePath = join(registry.projectPath, ".opencode", SKILL_REGISTRY_FILE)
  await writeFile(filePath, JSON.stringify(registry, null, 2) + "\n", "utf-8")
}

export function mergeManualSkills(
  registry: SkillRegistry,
  seeded: SeededSkill[]
): SkillRegistry {
  const existing = new Set(
    registry.skills.map((s) => `${s.category}:${normalizeContent(s.content)}`)
  )
  const newSkills: SkillRecord[] = seeded
    .filter((s) => typeof s.content === "string" && s.content.length > 0)
    .map((s) => {
      const id = makeSkillId(s.category, s.content)
      return {
        id,
        category: s.category,
        trigger: Array.isArray(s.trigger)
          ? s.trigger.filter((t): t is string => typeof t === "string")
          : deriveTrigger(s.content),
        content: s.content,
        source: "manual" as SkillSource,
        confidence: 1,
        useCount: 0,
        createdAt: now(),
        approved: true,
      }
    })
    .filter((s) => !existing.has(`${s.category}:${normalizeContent(s.content)}`))

  return {
    ...registry,
    skills: [...registry.skills, ...newSkills],
  }
}

export function deriveTrigger(content: string): string[] {
  const words = content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3)
  return Array.from(new Set(words)).slice(0, 5)
}

function tokenOverlap(trigger: string[], contextTokens: string[]): number {
  if (trigger.length === 0 || contextTokens.length === 0) return 0
  const contextSet = new Set(contextTokens)
  const hits = trigger.filter((t) => contextSet.has(t.toLowerCase())).length
  return hits / Math.sqrt(trigger.length * contextTokens.length)
}

function daysSince(iso: string): number {
  const then = new Date(iso).getTime()
  const nowMs = Date.now()
  return Math.max(0, (nowMs - then) / (1000 * 60 * 60 * 24))
}

export function selectSkillsForContext(
  registry: SkillRegistry,
  contextText: string,
  options: { maxSkills: number; threshold: number }
): SkillRecord[] {
  const contextTokens = contextText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2)

  const scored = registry.skills.map((skill) => {
    const recency = skill.lastUsed
      ? Math.max(0, 1 - daysSince(skill.lastUsed) / 30)
      : 0.5
    const engagement = Math.min(skill.useCount / 10, 1)
    const relevance = tokenOverlap(skill.trigger, contextTokens)
    const score =
      skill.confidence * 0.5 +
      relevance * 0.3 +
      recency * 0.1 +
      engagement * 0.1
    return { skill, score }
  })

  const passing = scored.filter(
    (s) =>
      s.score >= options.threshold &&
      (s.skill.useCount > 0 || tokenOverlap(s.skill.trigger, contextTokens) > 0)
  )
  const approved = passing
    .filter((s) => s.skill.approved)
    .sort((a, b) => b.score - a.score)
  const proposed = passing
    .filter(
      (s) =>
        !s.skill.approved &&
        s.skill.source === "reflection" &&
        tokenOverlap(s.skill.trigger, contextTokens) > 0
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)

  const combined = [...approved, ...proposed].slice(0, options.maxSkills)
  return combined.map((s) => s.skill)
}

export async function promoteSkill(
  skill: SkillRecord,
  projectPath: string,
  options: { autoPromote: boolean }
): Promise<"promoted" | "pending" | "skipped"> {
  if (skill.source === "promoted") return "skipped"
  if (skill.confidence < 0.8 || skill.useCount < 3 || !skill.approved) {
    return "skipped"
  }

  if (!options.autoPromote) {
    return "pending"
  }

  const target = await findInstructionFile(projectPath)
  if (!target) return "skipped"

  const filePath = join(projectPath, target)
  let content = ""
  try {
    content = await readFile(filePath, "utf-8")
  } catch {
    return "skipped"
  }

  const line = `- **[${skill.category}]** ${skill.content}`
  if (content.includes(line)) return "skipped"

  let newContent: string
  if (content.includes(SKILL_SECTION_HEADING)) {
    newContent = content.replace(
      new RegExp(`(${escapeRegExp(SKILL_SECTION_HEADING)}\s*\r?\n)`),
      `$1${line}\n`
    )
  } else {
    const appendix = `\n\n${SKILL_SECTION_HEADING}\n\n${line}\n`
    newContent = content.trimEnd() + appendix
  }

  await writeFile(filePath, newContent, "utf-8")
  return "promoted"
}

async function findInstructionFile(projectPath: string): Promise<string | null> {
  for (const file of INSTRUCTION_FILE_CANDIDATES) {
    try {
      await access(join(projectPath, file))
      return file
    } catch {
      // file does not exist, try next
    }
  }
  return null
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$")
}
