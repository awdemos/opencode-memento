import { describe, it, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { SessionContextPlugin } from "../src/plugin"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
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
    db.exec(`CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER, summary_files INTEGER, summary_additions INTEGER, summary_deletions INTEGER, summary_diffs TEXT)`)
    db.exec(`CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT)`)
    db.exec(`CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT)`)
    db.exec(`CREATE TABLE todo (session_id TEXT, content TEXT, status TEXT, priority TEXT, position INTEGER, time_created INTEGER)`)

    const sessionStmt = db.prepare(`INSERT INTO session (id, directory, title, time_created, summary_files, summary_additions, summary_deletions) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    for (let i = 0; i < 5; i++) {
      sessionStmt.run(`ses_${i}`, tmpDir, `Session ${i}`, Date.now() - i * 1000, i + 1, i * 10, i * 5)
    }
    sessionStmt.finalize()

    db.prepare(`INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)`).run("msg_0", "ses_0", Date.now(), JSON.stringify({ role: "assistant" }))
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`).run("prt_0", "msg_0", "ses_0", Date.now(), JSON.stringify({ type: "text", text: "The build failed with a SyntaxError exception." }))
    db.prepare(`INSERT INTO todo (session_id, content, status, priority, position, time_created) VALUES (?, ?, ?, ?, ?, ?)`).run("ses_0", "Fix the failing build", "open", "high", 0, Date.now())
    db.close()

    mkdirSync(join(tmpDir, ".opencode"), { recursive: true })
    writeFileSync(
      join(tmpDir, ".opencode", "session-context.json"),
      JSON.stringify({ dbPath })
    )
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
    expect(output.context[0]).toContain("Known Issues")
    expect(output.context[0]).toContain("Outstanding TODOs")
    expect(output.context[0]).toContain("Recent File Changes")

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("should inject Memento Skills section when skill memory is enabled", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    const dbPath = join(tmpDir, "test.db")
    const db = new Database(dbPath)
    db.exec(`CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER, summary_files INTEGER, summary_additions INTEGER, summary_deletions INTEGER, summary_diffs TEXT)`)
    db.exec(`CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT)`)
    db.exec(`CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT)`)
    db.exec(`CREATE TABLE todo (session_id TEXT, content TEXT, status TEXT, priority TEXT, position INTEGER, time_created INTEGER)`)

    const sessionStmt = db.prepare(`INSERT INTO session (id, directory, title, time_created, summary_files, summary_additions, summary_deletions) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    for (let i = 0; i < 5; i++) {
      sessionStmt.run(`ses_${i}`, tmpDir, `Session ${i}`, Date.now() - i * 1000, i + 1, i * 10, i * 5)
    }
    sessionStmt.finalize()

    db.prepare(`INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)`).run("msg_0", "ses_0", Date.now(), JSON.stringify({ role: "assistant" }))
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`).run("prt_0", "msg_0", "ses_0", Date.now(), JSON.stringify({ type: "text", text: "Before finishing, run typecheck." }))
    db.close()

    mkdirSync(join(tmpDir, ".opencode"), { recursive: true })
    writeFileSync(
      join(tmpDir, ".opencode", "session-context.json"),
      JSON.stringify({
        dbPath,
        enableSkillMemory: true,
        minSessions: 1,
        skills: [
          {
            category: "Always",
            content: "Run typecheck before claiming a fix is done.",
            trigger: ["typecheck"],
          },
        ],
      })
    )

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
    await pluginHooks["experimental.session.compacting"](
      { text: "Before finishing this change, run typecheck." },
      output
    )

    expect(output.context.some((c) => c.includes("Memento Skills"))).toBe(true)
    expect(
      output.context.some((c) =>
        c.includes("Run typecheck before claiming a fix is done.")
      )
    ).toBe(true)

    rmSync(tmpDir, { recursive: true, force: true })
  })
})
