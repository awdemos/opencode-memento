import { describe, it, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { getDb, getSessionCount, getRecentSessions, getErrorPatterns, getTodos, getDecisions } from "../src/db"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

describe("getDb", () => {
  it("should return null for nonexistent database", () => {
    const db = getDb("/tmp/nonexistent-db-" + Date.now() + ".db")
    expect(db).toBeNull()
  })

  it("should return readonly database for existing file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    const dbPath = join(tmpDir, "test.db")
    const setupDb = new Database(dbPath)
    setupDb.exec("CREATE TABLE session (id TEXT)")
    setupDb.close()

    const db = getDb(dbPath)
    expect(db).not.toBeNull()
    db?.close()

    rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe("getSessionCount", () => {
  it("should return 0 for missing database", () => {
    const count = getSessionCount("/tmp/fake", "/tmp/nonexistent-db-" + Date.now() + ".db")
    expect(count).toBe(0)
  })

  it("should count sessions for a directory", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    const dbPath = join(tmpDir, "test.db")
    const db = new Database(dbPath)
    db.exec(`CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER)`)
    const stmt = db.prepare(`INSERT INTO session (id, directory, title, time_created) VALUES (?, ?, ?, ?)`)
    stmt.run("ses_1", tmpDir, "Title", Date.now())
    stmt.run("ses_2", tmpDir, "Title 2", Date.now())
    stmt.run("ses_3", "/other/dir", "Other", Date.now())
    stmt.finalize()
    db.close()

    expect(getSessionCount(tmpDir, dbPath)).toBe(2)
    expect(getSessionCount("/other/dir", dbPath)).toBe(1)
    expect(getSessionCount("/unknown", dbPath)).toBe(0)

    rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe("getRecentSessions", () => {
  it("should return empty array for missing database", () => {
    const sessions = getRecentSessions("/tmp/fake", "/tmp/nonexistent-db-" + Date.now() + ".db", 3)
    expect(sessions).toEqual([])
  })

  it("should return recent sessions ordered by time_created DESC", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    const dbPath = join(tmpDir, "test.db")
    const db = new Database(dbPath)
    db.exec(`CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER)`)
    const stmt = db.prepare(`INSERT INTO session (id, directory, title, time_created) VALUES (?, ?, ?, ?)`)
    stmt.run("ses_old", tmpDir, "Old", 1000)
    stmt.run("ses_new", tmpDir, "New", 3000)
    stmt.run("ses_mid", tmpDir, "Mid", 2000)
    stmt.finalize()
    db.close()

    const sessions = getRecentSessions(tmpDir, dbPath, 2)
    expect(sessions).toHaveLength(2)
    expect(sessions[0].id).toBe("ses_new")
    expect(sessions[1].id).toBe("ses_mid")

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("should handle nullable titles gracefully", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    const dbPath = join(tmpDir, "test.db")
    const db = new Database(dbPath)
    db.exec(`CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER)`)
    const stmt = db.prepare(`INSERT INTO session (id, directory, title, time_created) VALUES (?, ?, ?, ?)`)
    stmt.run("ses_null", tmpDir, null, Date.now())
    stmt.finalize()
    db.close()

    const sessions = getRecentSessions(tmpDir, dbPath, 1)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].title).toBeUndefined()

    rmSync(tmpDir, { recursive: true, force: true })
  })
})

function seedProjectDb(tmpDir: string): string {
  const dbPath = join(tmpDir, "test.db")
  const db = new Database(dbPath)
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_created INTEGER)`)
  db.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)`)
  db.exec(`CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT)`)
  db.exec(`CREATE TABLE todo (session_id TEXT, content TEXT, status TEXT, priority TEXT, position INTEGER, time_created INTEGER)`)
  return dbPath
}

describe("getErrorPatterns", () => {
  it("should return empty array for missing database", () => {
    const errors = getErrorPatterns("/tmp/fake", "/tmp/nonexistent-db-" + Date.now() + ".db", 5)
    expect(errors).toEqual([])
  })

  it("should extract error lines from text parts", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    const dbPath = seedProjectDb(tmpDir)
    const db = new Database(dbPath)
    db.prepare(`INSERT INTO session (id, directory, title, time_created) VALUES (?, ?, ?, ?)`).run("ses_1", tmpDir, "Error Session", Date.now())
    db.prepare(`INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)`).run("msg_1", "ses_1", Date.now(), JSON.stringify({ role: "assistant" }))
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`).run("prt_1", "msg_1", "ses_1", Date.now(), JSON.stringify({ type: "text", text: "The build failed with a SyntaxError.\nThen a normal line." }))
    db.close()

    const errors = getErrorPatterns(tmpDir, dbPath, 5)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].error).toContain("failed")
    rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe("getTodos", () => {
  it("should return open todos from the todo table", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    const dbPath = seedProjectDb(tmpDir)
    const db = new Database(dbPath)
    db.prepare(`INSERT INTO session (id, directory, title, time_created) VALUES (?, ?, ?, ?)`).run("ses_1", tmpDir, "Todo Session", Date.now())
    db.prepare(`INSERT INTO todo (session_id, content, status, priority, position, time_created) VALUES (?, ?, ?, ?, ?, ?)`).run("ses_1", "Fix edge case", "open", "high", 0, Date.now())
    db.prepare(`INSERT INTO todo (session_id, content, status, priority, position, time_created) VALUES (?, ?, ?, ?, ?, ?)`).run("ses_1", "Already done", "completed", "low", 1, Date.now())
    db.close()

    const todos = getTodos(tmpDir, dbPath, 5)
    expect(todos).toHaveLength(1)
    expect(todos[0].todo).toContain("Fix edge case")
    rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe("getDecisions", () => {
  it("should extract decision lines from text parts", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memento-test-"))
    const dbPath = seedProjectDb(tmpDir)
    const db = new Database(dbPath)
    db.prepare(`INSERT INTO session (id, directory, title, time_created) VALUES (?, ?, ?, ?)`).run("ses_1", tmpDir, "Decision Session", Date.now())
    db.prepare(`INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)`).run("msg_1", "ses_1", Date.now(), JSON.stringify({ role: "assistant" }))
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`).run("prt_1", "msg_1", "ses_1", Date.now(), JSON.stringify({ type: "text", text: "We decided to use the repository pattern for data access.\nAnother line." }))
    db.close()

    const decisions = getDecisions(tmpDir, dbPath, 5)
    expect(decisions.length).toBeGreaterThan(0)
    expect(decisions[0].decision).toContain("decided")
    rmSync(tmpDir, { recursive: true, force: true })
  })
})
