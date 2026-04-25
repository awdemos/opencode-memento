import { describe, it, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { SessionContextPlugin } from "../src/plugin"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

describe("SessionContextPlugin hook", () => {
  it("should not inject context when session count is below threshold", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    const dbPath = join(tmpDir, "test.db")
    const db = new Database(dbPath)
    db.exec(`CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER)`)
    db.close()

    const mockClient = {
      app: {
        log: async () => {},
      },
    }

    const pluginHooks = await SessionContextPlugin({
      project: { id: "test", worktree: tmpDir, time: { created: Date.now() } },
      client: mockClient,
      directory: tmpDir,
      worktree: tmpDir,
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    })

    const output = { context: [] as string[] }
    await pluginHooks["experimental.session.compacting"]({}, output)
    expect(output.context).toHaveLength(0)

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("should inject context when session count meets threshold", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    const dbPath = join(tmpDir, "test.db")
    const db = new Database(dbPath)
    db.exec(`CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER)`)
    const stmt = db.prepare(`INSERT INTO session (id, directory, title, time_created) VALUES (?, ?, ?, ?)`)
    for (let i = 0; i < 5; i++) {
      stmt.run(`ses_${i}`, tmpDir, `Session ${i}`, Date.now() - i * 1000)
    }
    stmt.finalize()
    db.close()

    writeFileSync(join(tmpDir, "AGENTS.md"), "## Conventions\n- Use TypeScript\n")

    const mockClient = {
      app: {
        log: async () => {},
      },
    }

    const pluginHooks = await SessionContextPlugin({
      project: { id: "test", worktree: tmpDir, time: { created: Date.now() } },
      client: mockClient,
      directory: tmpDir,
      worktree: tmpDir,
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    })

    const output = { context: [] as string[] }
    await pluginHooks["experimental.session.compacting"]({}, output)
    expect(output.context.length).toBeGreaterThan(0)
    expect(output.context[0]).toContain("Session Context")

    rmSync(tmpDir, { recursive: true, force: true })
  })
})
