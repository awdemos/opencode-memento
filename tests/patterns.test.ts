import { describe, it, expect } from "bun:test"
import { discoverPatterns } from "../src/patterns"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const defaultConfig = {
  minSessions: 5,
  searchLimit: 3,
  maxPatterns: 12,
  maxCustomContextLines: 20,
  customContext: [],
  dbPath: "/tmp/fake.db",
}

describe("discoverPatterns", () => {
  it("should return empty array when no instruction file exists", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    const patterns = await discoverPatterns(tmpDir, defaultConfig)
    expect(patterns).toEqual([])
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("should extract conventions from AGENTS.md", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    writeFileSync(
      join(tmpDir, "AGENTS.md"),
      "## Conventions\n- Use TypeScript\n- Use early returns\n\n## Commands\n- npm test\n"
    )
    const patterns = await discoverPatterns(tmpDir, defaultConfig)
    expect(patterns.some((p) => p.includes("Convention") && p.includes("Use TypeScript"))).toBe(true)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("should fall back to CLAUDE.md when AGENTS.md is missing", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    writeFileSync(join(tmpDir, "CLAUDE.md"), "## Conventions\n- Prefer functional components\n")
    const patterns = await discoverPatterns(tmpDir, defaultConfig)
    expect(patterns.some((p) => p.includes("functional components"))).toBe(true)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("should extract boundaries with categories", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    writeFileSync(
      join(tmpDir, "AGENTS.md"),
      "## Boundaries\n### 🚫 Never\n- Commit secrets\n### ✅ Allowed\n- Run tests\n"
    )
    const patterns = await discoverPatterns(tmpDir, defaultConfig)
    expect(patterns.some((p) => p.includes("Boundary: Never") && p.includes("Commit secrets"))).toBe(true)
    expect(patterns.some((p) => p.includes("Boundary: Allowed") && p.includes("Run tests"))).toBe(true)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("should respect maxPatterns limit", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    const lines = Array.from({ length: 20 }, (_, i) => `- Convention ${i}`).join("\n")
    writeFileSync(join(tmpDir, "AGENTS.md"), `## Conventions\n${lines}\n`)
    const patterns = await discoverPatterns(tmpDir, { ...defaultConfig, maxPatterns: 5 })
    expect(patterns.length).toBeLessThanOrEqual(5)
    rmSync(tmpDir, { recursive: true, force: true })
  })
})
