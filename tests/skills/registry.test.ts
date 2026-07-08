import { describe, it, expect } from "bun:test"
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
          trigger: ["tests"],
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
