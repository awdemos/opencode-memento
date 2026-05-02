import { Database } from "bun:sqlite"

export interface SessionSummary {
  id: string
  date: string
  title?: string
}

export interface ErrorPattern {
  sessionId: string
  sessionTitle?: string
  error: string
  date: string
}

export interface TodoItem {
  sessionId: string
  sessionTitle?: string
  todo: string
  date: string
}

export interface Decision {
  sessionId: string
  sessionTitle?: string
  decision: string
  date: string
}

export interface FileChange {
  sessionId: string
  sessionTitle?: string
  files: number
  additions: number
  deletions: number
  diffs?: string
  date: string
}

export function getDb(dbPath: string): Database | null {
  try {
    const db = new Database(dbPath, { readonly: true, create: false })
    return db
  } catch (error) {
    console.debug(
      `[opencode-memento] Database connection failed:`,
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

export function getSessionCount(projectPath: string, dbPath: string): number {
  let db: Database | null = null
  try {
    db = getDb(dbPath)
    if (!db) {
      return 0
    }

    const query = db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) as count FROM session WHERE directory = ?"
    )
    const result = query.get(projectPath)
    const count = result?.count ?? 0
    return count
  } catch (error) {
    console.warn(
      `[opencode-memento] Error counting sessions:`,
      error instanceof Error ? error.message : String(error)
    )
    return 0
  } finally {
    db?.close()
  }
}

export function getRecentSessions(
  projectPath: string,
  dbPath: string,
  limit: number
): SessionSummary[] {
  let db: Database | null = null
  try {
    db = getDb(dbPath)
    if (!db) {
      return []
    }

    const query = db.query<
      { id: string; title: string | null; time_created: number },
      [string, number]
    >(
      "SELECT id, title, time_created FROM session WHERE directory = ? ORDER BY time_created DESC LIMIT ?"
    )

    const rows = query.all(projectPath, limit)

    return rows.map((row: { id: string; title: string | null; time_created: number }) => ({
      id: row.id,
      date: new Date(row.time_created).toISOString().split("T")[0],
      title: row.title ?? undefined,
    }))
  } catch (error) {
    console.warn(
      `[opencode-memento] Error getting recent sessions:`,
      error instanceof Error ? error.message : String(error)
    )
    return []
  } finally {
    db?.close()
  }
}

export function getErrorPatterns(
  projectPath: string,
  dbPath: string,
  limit: number
): ErrorPattern[] {
  let db: Database | null = null
  try {
    db = getDb(dbPath)
    if (!db) return []

    const query = db.query<
      { session_id: string; title: string | null; time_created: number; data: string },
      [string, number]
    >(
      `SELECT m.session_id, s.title, m.time_created, m.data 
       FROM message m
       JOIN session s ON m.session_id = s.id
       WHERE s.directory = ? AND (
         LOWER(json_extract(m.data, '$.content')) LIKE '%error%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%failed%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%failure%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%broken%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%exception%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%crash%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%does not work%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%isn''t working%'
       )
       ORDER BY m.time_created DESC
       LIMIT ?`
    )

    const rows = query.all(projectPath, limit * 3)
    const patterns: ErrorPattern[] = []
    const seen = new Set<string>()

    for (const row of rows) {
      try {
        const data = JSON.parse(row.data)
        const content = String(data.content || "")
        const lines = content.split("\n")
        
        for (const line of lines) {
          const lower = line.toLowerCase()
          if (
            (lower.includes("error") || lower.includes("failed") || 
             lower.includes("failure") || lower.includes("broken") ||
             lower.includes("exception") || lower.includes("crash")) &&
            line.length > 15 && line.length < 300
          ) {
            const normalized = line.trim().replace(/\s+/g, " ")
            if (!seen.has(normalized)) {
              seen.add(normalized)
              patterns.push({
                sessionId: row.session_id,
                sessionTitle: row.title ?? undefined,
                error: normalized,
                date: new Date(row.time_created).toISOString().split("T")[0],
              })
              if (patterns.length >= limit) break
            }
          }
        }
        if (patterns.length >= limit) break
      } catch {
        // Skip malformed JSON
      }
    }

    return patterns
  } catch (error) {
    console.warn(
      `[opencode-memento] Error getting error patterns:`,
      error instanceof Error ? error.message : String(error)
    )
    return []
  } finally {
    db?.close()
  }
}

export function getTodos(
  projectPath: string,
  dbPath: string,
  limit: number
): TodoItem[] {
  let db: Database | null = null
  try {
    db = getDb(dbPath)
    if (!db) return []

    const query = db.query<
      { session_id: string; title: string | null; time_created: number; data: string },
      [string, number]
    >(
      `SELECT m.session_id, s.title, m.time_created, m.data 
       FROM message m
       JOIN session s ON m.session_id = s.id
       WHERE s.directory = ? AND (
         LOWER(json_extract(m.data, '$.content')) LIKE '%todo%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%fixme%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%hack%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%bug%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%issue%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%needs to be%'
       )
       ORDER BY m.time_created DESC
       LIMIT ?`
    )

    const rows = query.all(projectPath, limit * 3)
    const todos: TodoItem[] = []
    const seen = new Set<string>()

    for (const row of rows) {
      try {
        const data = JSON.parse(row.data)
        const content = String(data.content || "")
        const lines = content.split("\n")
        
        for (const line of lines) {
          const lower = line.toLowerCase()
          if (
            (lower.includes("todo") || lower.includes("fixme") || 
             lower.includes("hack") || lower.includes("bug") ||
             lower.includes("issue") || lower.includes("needs to be")) &&
            line.length > 10 && line.length < 300 &&
            !lower.includes("github.com") &&
            !lower.includes("http")
          ) {
            const normalized = line.trim().replace(/\s+/g, " ")
            if (!seen.has(normalized)) {
              seen.add(normalized)
              todos.push({
                sessionId: row.session_id,
                sessionTitle: row.title ?? undefined,
                todo: normalized,
                date: new Date(row.time_created).toISOString().split("T")[0],
              })
              if (todos.length >= limit) break
            }
          }
        }
        if (todos.length >= limit) break
      } catch {
        // Skip malformed JSON
      }
    }

    return todos
  } catch (error) {
    console.warn(
      `[opencode-memento] Error getting TODOs:`,
      error instanceof Error ? error.message : String(error)
    )
    return []
  } finally {
    db?.close()
  }
}

export function getDecisions(
  projectPath: string,
  dbPath: string,
  limit: number
): Decision[] {
  let db: Database | null = null
  try {
    db = getDb(dbPath)
    if (!db) return []

    const query = db.query<
      { session_id: string; title: string | null; time_created: number; data: string },
      [string, number]
    >(
      `SELECT m.session_id, s.title, m.time_created, m.data 
       FROM message m
       JOIN session s ON m.session_id = s.id
       WHERE s.directory = ? AND (
         LOWER(json_extract(m.data, '$.content')) LIKE '%decided%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%decision%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%we should%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%let''s go with%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%going with%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%chose%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%choice%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%approach%' OR
         LOWER(json_extract(m.data, '$.content')) LIKE '%architecture%'
       )
       ORDER BY m.time_created DESC
       LIMIT ?`
    )

    const rows = query.all(projectPath, limit * 3)
    const decisions: Decision[] = []
    const seen = new Set<string>()

    for (const row of rows) {
      try {
        const data = JSON.parse(row.data)
        const content = String(data.content || "")
        const lines = content.split("\n")
        
        for (const line of lines) {
          const lower = line.toLowerCase()
          if (
            (lower.includes("decided") || lower.includes("decision") || 
             lower.includes("we should") || lower.includes("let's go with") ||
             lower.includes("going with") || lower.includes("chose") ||
             lower.includes("approach") || lower.includes("architecture")) &&
            line.length > 20 && line.length < 300
          ) {
            const normalized = line.trim().replace(/\s+/g, " ")
            if (!seen.has(normalized)) {
              seen.add(normalized)
              decisions.push({
                sessionId: row.session_id,
                sessionTitle: row.title ?? undefined,
                decision: normalized,
                date: new Date(row.time_created).toISOString().split("T")[0],
              })
              if (decisions.length >= limit) break
            }
          }
        }
        if (decisions.length >= limit) break
      } catch {
        // Skip malformed JSON
      }
    }

    return decisions
  } catch (error) {
    console.warn(
      `[opencode-memento] Error getting decisions:`,
      error instanceof Error ? error.message : String(error)
    )
    return []
  } finally {
    db?.close()
  }
}

export function getFileChanges(
  projectPath: string,
  dbPath: string,
  limit: number
): FileChange[] {
  let db: Database | null = null
  try {
    db = getDb(dbPath)
    if (!db) return []

    const query = db.query<
      { id: string; title: string | null; summary_files: number | null; summary_additions: number | null; summary_deletions: number | null; summary_diffs: string | null; time_created: number },
      [string, number]
    >(
      `SELECT id, title, summary_files, summary_additions, summary_deletions, summary_diffs, time_created 
       FROM session 
       WHERE directory = ? AND (summary_files > 0 OR summary_additions > 0 OR summary_deletions > 0)
       ORDER BY time_created DESC 
       LIMIT ?`
    )

    const rows = query.all(projectPath, limit)
    
    return rows.map((row) => ({
      sessionId: row.id,
      sessionTitle: row.title ?? undefined,
      files: row.summary_files ?? 0,
      additions: row.summary_additions ?? 0,
      deletions: row.summary_deletions ?? 0,
      diffs: row.summary_diffs ?? undefined,
      date: new Date(row.time_created).toISOString().split("T")[0],
    }))
  } catch (error) {
    console.warn(
      `[opencode-memento] Error getting file changes:`,
      error instanceof Error ? error.message : String(error)
    )
    return []
  } finally {
    db?.close()
  }
}
