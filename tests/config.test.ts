import { describe, it, expect } from "bun:test"
import { loadConfig, DEFAULT_CONFIG } from "../src/config"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

describe("loadConfig", () => {
  it("should return defaults when config file is missing", async () => {
    const config = await loadConfig("/tmp/nonexistent-path-" + Date.now())
    expect(config.minSessions).toBe(DEFAULT_CONFIG.minSessions)
    expect(config.searchLimit).toBe(DEFAULT_CONFIG.searchLimit)
    expect(config.dbPath).not.toStartWith("~")
  })

  it("should merge file config with defaults", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    mkdirSync(join(tmpDir, ".opencode"), { recursive: true })
    writeFileSync(
      join(tmpDir, ".opencode", "session-context.json"),
      JSON.stringify({ minSessions: 10, customContext: ["note"] })
    )
    const config = await loadConfig(tmpDir)
    expect(config.minSessions).toBe(10)
    expect(config.searchLimit).toBe(DEFAULT_CONFIG.searchLimit)
    expect(config.customContext).toEqual(["note"])
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("should expand tilde in dbPath", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    mkdirSync(join(tmpDir, ".opencode"), { recursive: true })
    writeFileSync(
      join(tmpDir, ".opencode", "session-context.json"),
      JSON.stringify({ dbPath: "~/custom.db" })
    )
    const config = await loadConfig(tmpDir)
    expect(config.dbPath).not.toStartWith("~")
    expect(config.dbPath).toEndWith("/custom.db")
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("should parse skill memory options", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    mkdirSync(join(tmpDir, ".opencode"), { recursive: true })
    writeFileSync(
      join(tmpDir, ".opencode", "session-context.json"),
      JSON.stringify({
        enableSkillMemory: true,
        maxSkills: 7,
        skills: [{ category: "Always", content: "Run tests." }],
      })
    )
    const config = await loadConfig(tmpDir)
    expect(config.enableSkillMemory).toBe(true)
    expect(config.maxSkills).toBe(7)
    expect(config.skills).toEqual([{ category: "Always", content: "Run tests." }])
    rmSync(tmpDir, { recursive: true, force: true })
  })
})
