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
    expect(result.updated[0].confidence).toBeGreaterThan(0.3)
  })
})
