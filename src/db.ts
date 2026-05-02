import { Database } from "bun:sqlite"

export interface SessionSummary {
  id: string
  date: string
  title?: string
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
