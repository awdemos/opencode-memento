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
  trigger: ["tests"],
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
