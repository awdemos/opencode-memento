# Leela-Style Agent Memory & Self-Improving Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a skill-memory subsystem to `opencode-memento` that reflects on OpenCode session history, proposes reusable project norms, injects relevant skills into compaction, and promotes stable skills back to project instruction files.

**Architecture:** The subsystem is isolated in `src/skills/` with three focused modules: a registry loader/writer + selector/promoter (`registry.ts`), a reflection heuristic that scans session content (`reflection.ts`), and a formatter that turns selected skills into markdown (`injection.ts`). Integration touches `src/config.ts` for new options and `src/plugin.ts` to run reflection once per session and inject skills. Persistence is a JSON file at `.opencode/memento-skills.json`.

**Tech Stack:** TypeScript, Bun test, `bun:sqlite`, `fs/promises`, existing `@opencode-ai/plugin` types.

---

## File Structure

### New files

- `src/skills/types.ts` — shared interfaces for `SkillRecord`, `SkillRegistry`, `SeededSkill`, `ReflectableSession`.
- `src/skills/registry.ts` — load/save registry, merge manual skills, duplicate detection, selection ranking, promotion to instruction files.
- `src/skills/reflection.ts` — scan messages/todos/errors/decisions and propose candidate skills.
- `src/skills/injection.ts` — format selected skills into markdown lines.
- `tests/skills/registry.test.ts` — registry load/save/merge/selection/promotion tests.
- `tests/skills/reflection.test.ts` — reflection heuristic tests.
- `tests/skills/injection.test.ts` — formatting tests.

### Modified files

- `src/config.ts` — add skill-memory options to `SessionContextConfig`, `DEFAULT_CONFIG`, and `validateConfig`.
- `src/plugin.ts` — load registry, run reflection once per session, select skills, inject section, update stats, promote stable skills.

---

## Task 1: Define shared skill types

**Files:**
- Create: `src/skills/types.ts`

- [ ] **Step 1: Create `src/skills/types.ts` with the following interfaces**

```ts
export type SkillCategory =
  | "Always"
  | "Never"
  | "Command"
  | "Convention"
  | "Boundary"
  | "Anti-Pattern"
  | "Testing"

export type SkillSource = "reflection" | "manual" | "promoted"

export interface SkillRecord {
  id: string
  category: SkillCategory
  trigger: string[]
  content: string
  source: SkillSource
  confidence: number
  useCount: number
  lastUsed?: string
  createdAt: string
  approved: boolean
}

export interface SkillRegistry {
  version: 1
  projectPath: string
  skills: SkillRecord[]
}

export interface SeededSkill {
  category: SkillCategory
  content: string
  trigger?: string[]
}

export interface ReflectableSession {
  id: string
  title?: string
  messages: string[]
  todos: string[]
  errors: string[]
  decisions: string[]
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bun run typecheck`
Expected: no errors (this file has no runtime).

- [ ] **Step 3: Commit**

```bash
git add src/skills/types.ts
git commit -m "feat(skills): add shared skill-memory types"
```

---

## Task 2: Build the skill registry

**Files:**
- Create: `src/skills/registry.ts`
- Create: `tests/skills/registry.test.ts`

- [ ] **Step 1: Write the failing registry test**

Create `tests/skills/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import {
  loadSkillRegistry,
  saveSkillRegistry,
  mergeManualSkills,
  selectSkillsForContext,
  promoteSkill,
  makeSkillId,
} from "../../src/skills/registry"
import type { SkillRecord, SeededSkill } from "../../src/skills/types"

async function tempProject(): Promise<string> {
  const dir = join(tmpdir(), `memento-skills-test-${Date.now()}`)
  await mkdir(join(dir, ".opencode"), { recursive: true })
  return dir
}

describe("loadSkillRegistry", () => {
  it("returns an empty registry when the file does not exist", async () => {
    const projectPath = await tempProject()
    const registry = await loadSkillRegistry(projectPath)
    expect(registry.version).toBe(1)
    expect(registry.projectPath).toBe(projectPath)
    expect(registry.skills).toEqual([])
    await rm(projectPath, { recursive: true, force: true })
  })

  it("loads an existing registry", async () => {
    const projectPath = await tempProject()
    const registryPath = join(projectPath, ".opencode", "memento-skills.json")
    const existing = {
      version: 1,
      projectPath,
      skills: [
        {
          id: "always-run-typecheck",
          category: "Always",
          trigger: ["typecheck", "fix"],
          content: "Run typecheck before claiming a fix is done.",
          source: "manual",
          confidence: 1,
          useCount: 0,
          createdAt: new Date().toISOString(),
          approved: true,
        } satisfies SkillRecord,
      ],
    }
    await writeFile(registryPath, JSON.stringify(existing))
    const loaded = await loadSkillRegistry(projectPath)
    expect(loaded.skills).toHaveLength(1)
    expect(loaded.skills[0].content).toBe("Run typecheck before claiming a fix is done.")
    await rm(projectPath, { recursive: true, force: true })
  })
})

describe("saveSkillRegistry", () => {
  it("writes the registry to disk", async () => {
    const projectPath = await tempProject()
    const registry = await loadSkillRegistry(projectPath)
    registry.skills.push({
      id: "never-commit-secrets",
      category: "Never",
      trigger: ["env", "secret"],
      content: "Never commit secrets or .env files.",
      source: "manual",
      confidence: 1,
      useCount: 2,
      lastUsed: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      approved: true,
    })
    await saveSkillRegistry(registry)
    const raw = JSON.parse(await readFile(join(projectPath, ".opencode", "memento-skills.json"), "utf-8"))
    expect(raw.skills).toHaveLength(1)
    await rm(projectPath, { recursive: true, force: true })
  })
})

describe("mergeManualSkills", () => {
  it("adds manual skills as approved", () => {
    const registry = {
      version: 1 as const,
      projectPath: "/tmp/project",
      skills: [],
    }
    const seeded: SeededSkill[] = [
      {
        category: "Always",
        content: "Run typecheck before claiming a fix is done.",
        trigger: ["typecheck"],
      },
    ]
    const merged = mergeManualSkills(registry, seeded)
    expect(merged.skills).toHaveLength(1)
    expect(merged.skills[0].approved).toBe(true)
    expect(merged.skills[0].source).toBe("manual")
    expect(merged.skills[0].trigger).toEqual(["typecheck"])
  })

  it("does not duplicate manual skills already in the registry", () => {
    const registry = {
      version: 1 as const,
      projectPath: "/tmp/project",
      skills: [
        {
          id: "always-run-typecheck",
          category: "Always",
          trigger: ["typecheck"],
          content: "Run typecheck before claiming a fix is done.",
          source: "manual",
          confidence: 1,
          useCount: 0,
          createdAt: new Date().toISOString(),
          approved: true,
        } satisfies SkillRecord,
      ],
    }
    const seeded: SeededSkill[] = [
      {
        category: "Always",
        content: "Run typecheck before claiming a fix is done.",
        trigger: ["typecheck"],
      },
    ]
    const merged = mergeManualSkills(registry, seeded)
    expect(merged.skills).toHaveLength(1)
  })
})

describe("selectSkillsForContext", () => {
  it("selects approved skills relevant to the context", () => {
    const registry = {
      version: 1 as const,
      projectPath: "/tmp/project",
      skills: [
        {
          id: "always-run-typecheck",
          category: "Always",
          trigger: ["typecheck"],
          content: "Run typecheck before claiming a fix is done.",
          source: "manual",
          confidence: 1,
          useCount: 0,
          createdAt: new Date().toISOString(),
          approved: true,
        } satisfies SkillRecord,
        {
          id: "never-commit-secrets",
          category: "Never",
          trigger: ["env"],
          content: "Never commit secrets.",
          source: "manual",
          confidence: 1,
          useCount: 0,
          createdAt: new Date().toISOString(),
          approved: true,
        } satisfies SkillRecord,
      ],
    }
    const selected = selectSkillsForContext(registry, "we fixed the auth bug and need typecheck", {
      maxSkills: 5,
      threshold: 0.3,
    })
    expect(selected.map((s) => s.id)).toContain("always-run-typecheck")
    expect(selected.map((s) => s.id)).not.toContain("never-commit-secrets")
  })

  it("does not select unapproved reflection candidates unless they rank highly", () => {
    const registry = {
      version: 1 as const,
      projectPath: "/tmp/project",
      skills: [
        {
          id: "always-write-tests",
          category: "Always",
          trigger: ["test"],
          content: "Always write tests for new behavior.",
          source: "reflection",
          confidence: 0.3,
          useCount: 0,
          createdAt: new Date().toISOString(),
          approved: false,
        } satisfies SkillRecord,
      ],
    }
    const selected = selectSkillsForContext(registry, "new feature needs tests", {
      maxSkills: 5,
      threshold: 0.3,
    })
    expect(selected).toHaveLength(1)
    expect(selected[0].id).toBe("always-write-tests")
  })
})

describe("promoteSkill", () => {
  it("appends a stable skill to an existing AGENTS.md when autoPromote is true", async () => {
    const projectPath = await tempProject()
    await writeFile(join(projectPath, "AGENTS.md"), "# Agent Instructions\n\n")
    const skill: SkillRecord = {
      id: "always-run-typecheck",
      category: "Always",
      trigger: ["typecheck"],
      content: "Run typecheck before claiming a fix is done.",
      source: "reflection",
      confidence: 0.85,
      useCount: 3,
      createdAt: new Date().toISOString(),
      approved: true,
    }
    const result = await promoteSkill(skill, projectPath, { autoPromote: true })
    expect(result).toBe("promoted")
    const text = await readFile(join(projectPath, "AGENTS.md"), "utf-8")
    expect(text).toContain("## Memento Skills")
    expect(text).toContain("Run typecheck before claiming a fix is done.")
    await rm(projectPath, { recursive: true, force: true })
  })

  it("returns pending when autoPromote is false", async () => {
    const projectPath = await tempProject()
    const skill: SkillRecord = {
      id: "always-run-typecheck",
      category: "Always",
      trigger: ["typecheck"],
      content: "Run typecheck before claiming a fix is done.",
      source: "reflection",
      confidence: 0.85,
      useCount: 3,
      createdAt: new Date().toISOString(),
      approved: true,
    }
    const result = await promoteSkill(skill, projectPath, { autoPromote: false })
    expect(result).toBe("pending")
    await rm(projectPath, { recursive: true, force: true })
  })
})

describe("makeSkillId", () => {
  it("creates a stable slug from category and content", () => {
    const id = makeSkillId("Always", "Run typecheck before claiming a fix is done.")
    expect(id).toBe("always-run-typecheck-before-claiming-a-fix-is-done")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/skills/registry.test.ts`
Expected: FAIL with module not found / function not defined errors.

- [ ] **Step 3: Implement `src/skills/registry.ts`**

Create `src/skills/registry.ts`:

```ts
import { readFile, writeFile, access } from "fs/promises"
import { join } from "path"
import type { ReflectableSession, SeededSkill, SkillCategory, SkillRecord, SkillRegistry, SkillSource } from "./types"

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
    .slice(0, 40)
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

export async function loadSkillRegistry(projectPath: string): Promise<SkillRegistry> {
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

export async function saveSkillRegistry(registry: SkillRegistry): Promise<void> {
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
  const now = Date.now()
  return Math.max(0, (now - then) / (1000 * 60 * 60 * 24))
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
    const recency = skill.lastUsed ? Math.max(0, 1 - daysSince(skill.lastUsed) / 30) : 0.5
    const engagement = Math.min(skill.useCount / 10, 1)
    const relevance = tokenOverlap(skill.trigger, contextTokens)
    const score = skill.confidence * 0.5 + relevance * 0.3 + recency * 0.1 + engagement * 0.1
    return { skill, score }
  })

  const passing = scored.filter((s) => s.score >= options.threshold)
  const approved = passing.filter((s) => s.skill.approved).sort((a, b) => b.score - a.score)
  const proposed = passing
    .filter((s) => !s.skill.approved && s.skill.source === "reflection")
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
      new RegExp(`(${escapeRegExp(SKILL_SECTION_HEADING)}\\s*\\r?\\n)`),
      `$1${line}\\n`
    )
  } else {
    const appendix = `\\n\\n${SKILL_SECTION_HEADING}\\n\\n${line}\\n`
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
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
```

- [ ] **Step 4: Run the registry tests**

Run: `bun test tests/skills/registry.test.ts`
Expected: all tests pass.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/skills/types.ts src/skills/registry.ts tests/skills/registry.test.ts
git commit -m "feat(skills): add skill registry with load, save, merge, select, and promote"
```

---

## Task 3: Implement reflection heuristics

**Files:**
- Create: `src/skills/reflection.ts`
- Create: `tests/skills/reflection.test.ts`

- [ ] **Step 1: Write the failing reflection test**

Create `tests/skills/reflection.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { reflectOnSessions } from "../../src/skills/reflection"
import type { ReflectableSession, SkillRegistry } from "../../src/skills/types"

describe("reflectOnSessions", () => {
  it("proposes a skill from an explicit normative statement", () => {
    const sessions: ReflectableSession[] = [
      {
        id: "ses-1",
        title: "Auth refactor",
        messages: ["We should always run typecheck before claiming a fix is done."],
        todos: [],
        errors: [],
        decisions: [],
      },
    ]
    const registry: SkillRegistry = {
      version: 1,
      projectPath: "/tmp/project",
      skills: [],
    }
    const result = reflectOnSessions(registry, sessions, { maxCandidates: 3 })
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates[0].category).toBe("Always")
    expect(result.candidates[0].approved).toBe(false)
    expect(result.candidates[0].source).toBe("reflection")
  })

  it("proposes a skill from a recurring TODO", () => {
    const sessions: ReflectableSession[] = [
      {
        id: "ses-1",
        title: "Setup",
        messages: [],
        todos: ["Add tests for the auth middleware"],
        errors: [],
        decisions: [],
      },
      {
        id: "ses-2",
        title: "Auth work",
        messages: [],
        todos: ["Add tests for the auth middleware"],
        errors: [],
        decisions: [],
      },
    ]
    const registry: SkillRegistry = {
      version: 1,
      projectPath: "/tmp/project",
      skills: [],
    }
    const result = reflectOnSessions(registry, sessions, { maxCandidates: 3 })
    expect(result.candidates.some((c) => c.content.toLowerCase().includes("auth middleware"))).toBe(true)
  })

  it("does not duplicate an existing skill", () => {
    const sessions: ReflectableSession[] = [
      {
        id: "ses-1",
        title: "Auth refactor",
        messages: ["We should always run typecheck before claiming a fix is done."],
        todos: [],
        errors: [],
        decisions: [],
      },
    ]
    const registry: SkillRegistry = {
      version: 1,
      projectPath: "/tmp/project",
      skills: [
        {
          id: "always-run-typecheck-before-claiming-a-fix-is-done",
          category: "Always",
          trigger: ["typecheck"],
          content: "Run typecheck before claiming a fix is done.",
          source: "reflection",
          confidence: 0.3,
          useCount: 0,
          createdAt: new Date().toISOString(),
          approved: false,
        },
      ],
    }
    const result = reflectOnSessions(registry, sessions, { maxCandidates: 3 })
    expect(result.candidates).toHaveLength(0)
    expect(result.updated[0].useCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/skills/reflection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/skills/reflection.ts`**

Create `src/skills/reflection.ts`:

```ts
import { deriveTrigger, makeSkillId } from "./registry"
import type { ReflectableSession, SkillCategory, SkillRecord, SkillRegistry } from "./types"

const NORMATIVE_MARKERS = [
  { pattern: /\b(we\s+)?always\s+(.+?)(?:\.|$)/i, category: "Always" as SkillCategory },
  { pattern: /\b(we\s+)?never\s+(.+?)(?:\.|$)/i, category: "Never" as SkillCategory },
  { pattern: /\bshould\s+(.+?)(?:\.|$)/i, category: "Convention" as SkillCategory },
  { pattern: /\bmust\s+not\s+(.+?)(?:\.|$)/i, category: "Never" as SkillCategory },
]

function now(): string {
  return new Date().toISOString()
}

function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function extractNormativeStatements(text: string): Array<{ category: SkillCategory; content: string }> {
  const results: Array<{ category: SkillCategory; content: string }> = []
  const sentences = text.split(/(?<=[.!?])\s+/)
  for (const sentence of sentences) {
    for (const { pattern, category } of NORMATIVE_MARKERS) {
      const match = sentence.match(pattern)
      if (match) {
        const raw = match[2] ?? match[1]
        if (raw && raw.length > 5) {
          results.push({ category, content: raw.trim().replace(/\s+/g, " ") })
        }
      }
    }
  }
  return results
}

function findRecurring<T>(items: T[], normalize: (item: T) => string, minOccurrences = 2): T[] {
  const counts = new Map<string, { count: number; example: T }>()
  for (const item of items) {
    const key = normalize(item)
    if (key.length < 5) continue
    const existing = counts.get(key)
    if (existing) {
      existing.count++
    } else {
      counts.set(key, { count: 1, example: item })
    }
  }
  return Array.from(counts.values())
    .filter((entry) => entry.count >= minOccurrences)
    .map((entry) => entry.example)
}

function categorizeTodo(content: string): SkillCategory {
  const lower = content.toLowerCase()
  if (lower.includes("test") || lower.includes("spec")) return "Testing"
  if (lower.includes("fixme") || lower.includes("fix")) return "Anti-Pattern"
  return "Convention"
}

function categorizeError(content: string): SkillCategory {
  return "Anti-Pattern"
}

function categorizeDecision(content: string): SkillCategory {
  return "Convention"
}

export function reflectOnSessions(
  registry: SkillRegistry,
  sessions: ReflectableSession[],
  options: { maxCandidates: number }
): { candidates: SkillRecord[]; updated: SkillRecord[] } {
  const existingKeys = new Set(
    registry.skills.map((s) => `${s.category}:${normalizeContent(s.content)}`)
  )

  const allNormative: Array<{ category: SkillCategory; content: string }> = []
  const allTodos: string[] = []
  const allErrors: string[] = []
  const allDecisions: string[] = []

  for (const session of sessions) {
    for (const message of session.messages) {
      allNormative.push(...extractNormativeStatements(message))
    }
    allTodos.push(...session.todos)
    allErrors.push(...session.errors)
    allDecisions.push(...session.decisions)
  }

  const candidates: SkillRecord[] = []
  const updated: SkillRecord[] = [...registry.skills]

  function addOrUpdate(category: SkillCategory, content: string): void {
    const normalized = normalizeContent(content)
    const key = `${category}:${normalized}`
    const existingIndex = updated.findIndex(
      (s) => `${s.category}:${normalizeContent(s.content)}` === key
    )

    if (existingIndex >= 0) {
      const existing = updated[existingIndex]
      updated[existingIndex] = {
        ...existing,
        confidence: Math.min(1, existing.confidence + 0.1),
        useCount: existing.useCount,
      }
      return
    }

    if (existingKeys.has(key)) return
    if (candidates.some((c) => `${c.category}:${normalizeContent(c.content)}` === key)) return

    candidates.push({
      id: makeSkillId(category, content),
      category,
      trigger: deriveTrigger(content),
      content,
      source: "reflection",
      confidence: 0.3,
      useCount: 0,
      createdAt: now(),
      approved: false,
    })
  }

  for (const { category, content } of allNormative) {
    addOrUpdate(category, content)
  }

  for (const todo of findRecurring(allTodos, (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())) {
    addOrUpdate(categorizeTodo(todo), todo)
  }

  for (const error of findRecurring(allErrors, (e) => e.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())) {
    addOrUpdate(categorizeError(error), error)
  }

  for (const decision of findRecurring(allDecisions, (d) => d.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())) {
    addOrUpdate(categorizeDecision(decision), decision)
  }

  return {
    candidates: candidates.slice(0, options.maxCandidates),
    updated,
  }
}
```

- [ ] **Step 4: Run the reflection tests**

Run: `bun test tests/skills/reflection.test.ts`
Expected: all tests pass.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/skills/reflection.ts tests/skills/reflection.test.ts
git commit -m "feat(skills): add reflection heuristics for skill proposals"
```

---

## Task 4: Implement skill injection formatting

**Files:**
- Create: `src/skills/injection.ts`
- Create: `tests/skills/injection.test.ts`

- [ ] **Step 1: Write the failing injection test**

Create `tests/skills/injection.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { formatSkillsSection } from "../../src/skills/injection"
import type { SkillRecord } from "../../src/skills/types"

const manualSkill: SkillRecord = {
  id: "always-run-typecheck",
  category: "Always",
  trigger: ["typecheck"],
  content: "Run typecheck before claiming a fix is done.",
  source: "manual",
  confidence: 1,
  useCount: 2,
  createdAt: new Date().toISOString(),
  approved: true,
}

const proposedSkill: SkillRecord = {
  id: "always-write-tests",
  category: "Always",
  trigger: ["test"],
  content: "Always write tests for new behavior.",
  source: "reflection",
  confidence: 0.3,
  useCount: 0,
  createdAt: new Date().toISOString(),
  approved: false,
}

describe("formatSkillsSection", () => {
  it("formats approved skills", () => {
    const lines = formatSkillsSection([manualSkill])
    expect(lines).toContain("### Memento Skills")
    expect(lines.some((l) => l.includes("[Always] Run typecheck before claiming a fix is done."))).toBe(true)
  })

  it("labels proposed skills", () => {
    const lines = formatSkillsSection([proposedSkill])
    expect(lines.some((l) => l.includes("[Proposed]"))).toBe(true)
  })

  it("returns empty when no skills are provided", () => {
    expect(formatSkillsSection([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/skills/injection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/skills/injection.ts`**

Create `src/skills/injection.ts`:

```ts
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
```

- [ ] **Step 4: Run the injection tests**

Run: `bun test tests/skills/injection.test.ts`
Expected: all tests pass.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/skills/injection.ts tests/skills/injection.test.ts
git commit -m "feat(skills): add skill section formatting"
```

---

## Task 5: Wire configuration options

**Files:**
- Modify: `src/config.ts`
- Test: existing `tests/config.test.ts`

- [ ] **Step 1: Add skill-memory options to `SessionContextConfig`**

In `src/config.ts`, update the interface and defaults:

```ts
export interface SessionContextConfig {
  // ... existing options
  enableSkillMemory?: boolean
  maxSkills?: number
  skillConfidenceThreshold?: number
  autoPromoteSkills?: boolean
  maxReflectionCandidates?: number
  skills?: Array<{
    category: string
    content: string
    trigger?: string[]
  }>
}

export const DEFAULT_CONFIG: Required<SessionContextConfig> = {
  // ... existing defaults
  enableSkillMemory: false,
  maxSkills: 5,
  skillConfidenceThreshold: 0.3,
  autoPromoteSkills: false,
  maxReflectionCandidates: 3,
  skills: [],
}
```

Also update `validateConfig` to accept the new fields:

```ts
if (typeof config.enableSkillMemory === "boolean") result.enableSkillMemory = config.enableSkillMemory
if (typeof config.maxSkills === "number") result.maxSkills = config.maxSkills
if (typeof config.skillConfidenceThreshold === "number") result.skillConfidenceThreshold = config.skillConfidenceThreshold
if (typeof config.autoPromoteSkills === "boolean") result.autoPromoteSkills = config.autoPromoteSkills
if (typeof config.maxReflectionCandidates === "number") result.maxReflectionCandidates = config.maxReflectionCandidates
if (Array.isArray(config.skills)) {
  result.skills = config.skills.filter(
    (s): s is { category: string; content: string; trigger?: string[] } =>
      s !== null &&
      typeof s === "object" &&
      typeof (s as Record<string, unknown>).category === "string" &&
      typeof (s as Record<string, unknown>).content === "string"
  )
}
```

- [ ] **Step 2: Add a config test for skill-memory options**

Append to `tests/config.test.ts` (or create a new test block if needed):

```ts
it("parses skill memory options", async () => {
  const dir = join(tmpdir(), `config-test-skills-${Date.now()}`)
  await mkdir(join(dir, ".opencode"), { recursive: true })
  await writeFile(
    join(dir, ".opencode", "session-context.json"),
    JSON.stringify({
      enableSkillMemory: true,
      maxSkills: 7,
      skills: [{ category: "Always", content: "Run tests." }],
    })
  )
  const config = await loadConfig(dir)
  expect(config.enableSkillMemory).toBe(true)
  expect(config.maxSkills).toBe(7)
  expect(config.skills).toEqual([{ category: "Always", content: "Run tests." }])
  await rm(dir, { recursive: true, force: true })
})
```

- [ ] **Step 3: Run config tests**

Run: `bun test tests/config.test.ts`
Expected: all tests pass.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): add skill-memory configuration options"
```

---

## Task 6: Integrate skills into the plugin

**Files:**
- Modify: `src/plugin.ts`
- Test: `tests/plugin.test.ts` and/or new `tests/skills/plugin-integration.test.ts`

- [ ] **Step 1: Add skill imports and state to `src/plugin.ts`**

At the top of `src/plugin.ts`, add:

```ts
import { formatSkillsSection } from "./skills/injection"
import {
  loadSkillRegistry,
  saveSkillRegistry,
  mergeManualSkills,
  selectSkillsForContext,
  promoteSkill,
} from "./skills/registry"
import { reflectOnSessions } from "./skills/reflection"
import type { SkillRecord } from "./skills/types"
```

- [ ] **Step 2: Add session reflection helpers**

Add new imports from `src/db.ts` to read session content for reflection. We can reuse `getRecentSessions` plus message query helpers. Add a lightweight helper inside `src/plugin.ts`:

```ts
import { Database } from "bun:sqlite"

function gatherReflectableSessions(
  db: Database,
  projectPath: string,
  limit: number
): ReflectableSession[] {
  const sessionQuery = db.query<
    { id: string; title: string | null; time_created: number },
    [string, number]
  >(
    "SELECT id, title, time_created FROM session WHERE directory = ? ORDER BY time_created DESC LIMIT ?"
  )
  const sessions = sessionQuery.all(projectPath, limit)

  const messageQuery = db.query<
    { session_id: string; text: string },
    [string]
  >(
    `SELECT m.session_id, json_extract(p.data, '$.text') as text
     FROM part p
     JOIN message m ON p.message_id = m.id
     JOIN session s ON m.session_id = s.id
     WHERE s.directory = ? AND json_extract(p.data, '$.type') IN ('text', 'reasoning')`
  )
  const todoQuery = db.query<
    { session_id: string; content: string },
    [string]
  >(
    `SELECT t.session_id, t.content
     FROM todo t
     JOIN session s ON t.session_id = s.id
     WHERE s.directory = ? AND t.status != 'completed'`
  )

  const messagesBySession = new Map<string, string[]>()
  for (const row of messageQuery.all(projectPath)) {
    const list = messagesBySession.get(row.session_id) || []
    if (row.text) list.push(String(row.text))
    messagesBySession.set(row.session_id, list)
  }

  const todosBySession = new Map<string, string[]>()
  for (const row of todoQuery.all(projectPath)) {
    const list = todosBySession.get(row.session_id) || []
    list.push(row.content)
    todosBySession.set(row.session_id, list)
  }

  return sessions.map((s) => ({
    id: s.id,
    title: s.title ?? undefined,
    messages: messagesBySession.get(s.id) || [],
    todos: todosBySession.get(s.id) || [],
    errors: [],
    decisions: [],
  }))
}
```

- [ ] **Step 3: Integrate skill logic into the plugin body**

Inside `SessionContextPlugin`, after the vector/indexing setup, add:

```ts
let skillRegistry = await loadSkillRegistry(projectPath)
skillRegistry = mergeManualSkills(skillRegistry, config.skills)
let skillsReflected = false

async function reflectOnce(): Promise<void> {
  if (skillsReflected || !config.enableSkillMemory) return
  const db = getDb(config.dbPath)
  if (!db) return
  try {
    const sessions = gatherReflectableSessions(db, projectPath, Math.max(config.searchLimit * 2, 10))
    if (sessions.length === 0) return
    const { candidates, updated } = reflectOnSessions(skillRegistry, sessions, {
      maxCandidates: config.maxReflectionCandidates,
    })
    skillRegistry = { ...updated, skills: [...updated.skills, ...candidates] }
    if (candidates.length > 0) {
      await client.app.log({
        body: {
          service: "opencode-memento",
          level: "info",
          message: `Proposed ${candidates.length} skill candidate(s) from session reflection`,
        },
      })
    }
    await saveSkillRegistry(skillRegistry)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[opencode-memento] Skill reflection failed: ${msg}`)
  } finally {
    db.close()
    skillsReflected = true
  }
}
```

- [ ] **Step 4: Inject skills during compaction**

Inside the `experimental.session.compacting` hook, after the pattern-discovery block and before the custom-context block, add:

```ts
if (config.enableSkillMemory) {
  await reflectOnce()

  const contextText = [
    output.session?.title ?? "",
    output.session?.id ?? "",
    ...(output.context || []),
  ].join(" ")

  const selected = selectSkillsForContext(skillRegistry, contextText, {
    maxSkills: config.maxSkills,
    threshold: config.skillConfidenceThreshold,
  })

  if (selected.length > 0) {
    hasContent = true
    contextSections.push(...formatSkillsSection(selected))

    const now = new Date().toISOString()
    const updatedSkills = skillRegistry.skills.map((skill) => {
      if (selected.some((s) => s.id === skill.id)) {
        return {
          ...skill,
          useCount: skill.useCount + 1,
          lastUsed: now,
        }
      }
      return skill
    })
    skillRegistry = { ...skillRegistry, skills: updatedSkills }

    for (const skill of selected) {
      const promotionResult = await promoteSkill(skill, projectPath, {
        autoPromote: config.autoPromoteSkills,
      })
      if (promotionResult === "pending") {
        await client.app.log({
          body: {
            service: "opencode-memento",
            level: "info",
            message: `Skill "${skill.content}" is ready for promotion to instruction file`,
          },
        })
      }
    }

    await saveSkillRegistry(skillRegistry).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[opencode-memento] Failed to save skill registry: ${msg}`)
    })
  }
}
```

Note: the `output.session` shape may not exist on the current plugin input type. If TypeScript complains, use `((output as Record<string, unknown>).session as { title?: string; id?: string } | undefined)` — but prefer adding a local type guard function instead of casting when possible.

- [ ] **Step 5: Add plugin integration test**

Append to `tests/plugin.test.ts` (or create `tests/skills/plugin-integration.test.ts` if the existing test is already long):

```ts
it("injects a Memento Skills section when skill memory is enabled", async () => {
  const projectPath = join(tmpdir(), `plugin-skills-${Date.now()}`)
  await mkdir(join(projectPath, ".opencode"), { recursive: true })

  const dbPath = createTestDb(projectPath)
  await writeFile(
    join(projectPath, ".opencode", "session-context.json"),
    JSON.stringify({
      dbPath,
      enableSkillMemory: true,
      minSessions: 1,
      skills: [{ category: "Always", content: "Run typecheck before claiming a fix is done.", trigger: ["typecheck"] }],
    })
  )

  const plugin = SessionContextPlugin({ client: makeClient(), directory: projectPath })
  const output = { context: [] as string[] }
  const handler = (plugin as Record<string, unknown>)["experimental.session.compacting"] as
    | ((input: unknown, output: { context: string[] }) => Promise<void>)
    | undefined
  expect(handler).toBeDefined()
  await handler?.({}, output)

  expect(output.context.some((c) => c.includes("Memento Skills"))).toBe(true)
  expect(output.context.some((c) => c.includes("Run typecheck before claiming a fix is done."))).toBe(true)

  await rm(projectPath, { recursive: true, force: true })
})
```

Use the existing `makeClient()` and test-DB helpers from `tests/plugin.test.ts`.

- [ ] **Step 6: Run all tests**

Run: `bun test`
Expected: all tests pass.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/plugin.ts tests/plugin.test.ts
git commit -m "feat(plugin): integrate skill memory into compaction"
```

---

## Task 7: Update README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Skill Memory" section**

After the "Vector Search vs SQLite" table, add:

```markdown
## Skill Memory (Experimental)

When `enableSkillMemory` is true, the plugin maintains a local registry of reusable project skills at `.opencode/memento-skills.json`. It can:

- **Propose skills automatically** by reflecting on recent sessions for repeated TODOs, recurring errors, and explicit normative statements ("always", "never", "should").
- **Seed skills manually** through the `skills` array in `.opencode/session-context.json`.
- **Inject relevant skills** into compaction context under `### Memento Skills`.
- **Promote stable skills** to your project's instruction file (`AGENTS.md`, `CLAUDE.md`, etc.) when they reach high confidence and repeated use.

Enable it:

```json
{
  "enableSkillMemory": true,
  "maxSkills": 5,
  "autoPromoteSkills": false
}
```

Proposed skills are labeled `[Proposed]` until you approve them by editing the registry.
```

- [ ] **Step 2: Add skill-memory options to the configuration table**

Append these rows to the existing options table:

| Option | Default | Description |
|--------|---------|-------------|
| `enableSkillMemory` | `false` | Enable the skill-memory subsystem |
| `maxSkills` | `5` | Max skills to inject into compaction |
| `skillConfidenceThreshold` | `0.3` | Minimum relevance score for a skill to be injected |
| `autoPromoteSkills` | `false` | Append high-confidence skills to instruction files automatically |
| `skills` | `[]` | Manually seeded skills |
| `maxReflectionCandidates` | `3` | Max unapproved reflection candidates per session |

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document skill-memory feature"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: all tests pass.

- [ ] **Step 3: Run build**

Run: `bun run build`
Expected: `dist/` generated successfully.

- [ ] **Step 4: Commit any final fixes**

If any changes were needed to pass verification:

```bash
git add -A
git commit -m "fix(skills): address typecheck/test issues"
```

---

## Spec Coverage Review

| Spec Section | Task(s) |
|---|---|
| Data model `memento-skills.json` | Task 1, Task 2 |
| Configuration additions | Task 5 |
| Registry load/save/merge/select/promote | Task 2 |
| Automatic reflection | Task 3, Task 6 |
| Injection behavior | Task 4, Task 6 |
| Manual seeding | Task 2, Task 5 |
| Promotion to instruction files | Task 2, Task 6 |
| Error handling | Embedded in each task (try/catch, fallbacks) |
| Ranking formula | Task 2 |
| Testing plan | All tasks |
| Documentation | Task 7 |

## Placeholder Scan

- No TBD/TODO placeholders remain.
- Each task includes concrete code, exact commands, and expected outputs.
- Type names are consistent across tasks (`SkillRecord`, `SkillRegistry`, `ReflectableSession`, `SeededSkill`).
