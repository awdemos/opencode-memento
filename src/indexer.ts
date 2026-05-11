import { Database } from "bun:sqlite"
import type { SessionChunk } from "./vector-client"

interface PartRow {
  session_id: string
  message_id: string
  time_created: number
  data: string
}

interface TodoRow {
  session_id: string
  content: string
  status: string
  priority: string
  time_created: number
}

function parsePartText(data: string): string {
  try {
    const parsed = JSON.parse(data)
    if (parsed.type === "text" && typeof parsed.text === "string") {
      return parsed.text.trim()
    }
    if (parsed.type === "reasoning" && typeof parsed.text === "string") {
      return parsed.text.trim()
    }
  } catch {}
  return ""
}

export function extractSessionMessages(
  db: Database,
  projectPath: string
): Map<string, SessionChunk[]> {
  const query = db.query<PartRow, [string]>(
    `SELECT p.session_id, p.message_id, p.time_created, p.data
     FROM part p
     JOIN session s ON p.session_id = s.id
     WHERE s.directory = ? AND json_extract(p.data, '$.type') IN ('text', 'reasoning')
     ORDER BY p.session_id, p.time_created`
  )

  const rows = query.all(projectPath)
  const sessions = new Map<string, SessionChunk[]>()

  for (const row of rows) {
    const text = parsePartText(row.data)
    if (!text || text.length < 5) continue

    const chunks = sessions.get(row.session_id) || []
    chunks.push({
      chunk_id: `${row.session_id}_msg_${row.message_id}_${row.time_created}`,
      session_id: row.session_id,
      text,
      source: "message",
      metadata: {
        time_created: row.time_created,
        message_id: row.message_id,
      },
    })
    sessions.set(row.session_id, chunks)
  }

  return sessions
}

export function extractSessionTodos(
  db: Database,
  projectPath: string
): Map<string, SessionChunk[]> {
  const query = db.query<TodoRow, [string]>(
    `SELECT t.session_id, t.content, t.status, t.priority, t.time_created
     FROM todo t
     JOIN session s ON t.session_id = s.id
     WHERE s.directory = ?
     ORDER BY t.session_id, t.position`
  )

  const rows = query.all(projectPath)
  const sessions = new Map<string, SessionChunk[]>()

  for (const row of rows) {
    const content = row.content.trim()
    if (!content || content.length < 3) continue

    const chunks = sessions.get(row.session_id) || []
    chunks.push({
      chunk_id: `${row.session_id}_todo_${row.time_created}_${chunks.length}`,
      session_id: row.session_id,
      text: `[${row.status}] ${content}`,
      source: "todo",
      metadata: {
        time_created: row.time_created,
        priority: row.priority,
        status: row.status,
      },
    })
    sessions.set(row.session_id, chunks)
  }

  return sessions
}

export function extractSessionErrors(
  db: Database,
  projectPath: string
): Map<string, SessionChunk[]> {
  const query = db.query<PartRow, [string]>(
    `SELECT p.session_id, p.message_id, p.time_created, p.data
     FROM part p
     JOIN session s ON p.session_id = s.id
     WHERE s.directory = ? AND json_extract(p.data, '$.type') IN ('text', 'reasoning')
     ORDER BY p.session_id, p.time_created`
  )

  const rows = query.all(projectPath)
  const sessions = new Map<string, SessionChunk[]>()

  for (const row of rows) {
    const text = parsePartText(row.data)
    if (!text) continue

    const lines = text.split("\n")
    for (const line of lines) {
      const lower = line.toLowerCase()
      if (
        (lower.includes("error") || lower.includes("failed") ||
         lower.includes("failure") || lower.includes("broken") ||
         lower.includes("exception") || lower.includes("crash")) &&
        line.length > 15 && line.length < 300
      ) {
        const chunks = sessions.get(row.session_id) || []
        chunks.push({
          chunk_id: `${row.session_id}_error_${row.message_id}_${row.time_created}_${chunks.length}`,
          session_id: row.session_id,
          text: line.trim().replace(/\s+/g, " "),
          source: "error",
          metadata: {
            time_created: row.time_created,
            message_id: row.message_id,
          },
        })
        sessions.set(row.session_id, chunks)
      }
    }
  }

  return sessions
}

export function extractSessionDecisions(
  db: Database,
  projectPath: string
): Map<string, SessionChunk[]> {
  const query = db.query<PartRow, [string]>(
    `SELECT p.session_id, p.message_id, p.time_created, p.data
     FROM part p
     JOIN session s ON p.session_id = s.id
     WHERE s.directory = ? AND json_extract(p.data, '$.type') IN ('text', 'reasoning')
     ORDER BY p.session_id, p.time_created`
  )

  const rows = query.all(projectPath)
  const sessions = new Map<string, SessionChunk[]>()

  for (const row of rows) {
    const text = parsePartText(row.data)
    if (!text) continue

    const lines = text.split("\n")
    for (const line of lines) {
      const lower = line.toLowerCase()
      if (
        (lower.includes("decided") || lower.includes("decision") ||
         lower.includes("we should") || lower.includes("let's go with") ||
         lower.includes("going with") || lower.includes("chose") ||
         lower.includes("approach") || lower.includes("architecture")) &&
        line.length > 20 && line.length < 300
      ) {
        const chunks = sessions.get(row.session_id) || []
        chunks.push({
          chunk_id: `${row.session_id}_decision_${row.message_id}_${row.time_created}_${chunks.length}`,
          session_id: row.session_id,
          text: line.trim().replace(/\s+/g, " "),
          source: "decision",
          metadata: {
            time_created: row.time_created,
            message_id: row.message_id,
          },
        })
        sessions.set(row.session_id, chunks)
      }
    }
  }

  return sessions
}

export function extractSessionFileChanges(
  db: Database,
  projectPath: string
): Map<string, SessionChunk[]> {
  interface SessionRow {
    id: string
    title: string | null
    summary_files: number | null
    summary_additions: number | null
    summary_deletions: number | null
    summary_diffs: string | null
    time_created: number
  }

  const query = db.query<SessionRow, [string, number]>(
    `SELECT id, title, summary_files, summary_additions, summary_deletions, summary_diffs, time_created
     FROM session
     WHERE directory = ? AND (summary_files > 0 OR summary_additions > 0 OR summary_deletions > 0)
     ORDER BY time_created DESC`
  )

  const rows = query.all(projectPath, Number.MAX_SAFE_INTEGER)
  const sessions = new Map<string, SessionChunk[]>()

  for (const row of rows) {
    const files = row.summary_files ?? 0
    const additions = row.summary_additions ?? 0
    const deletions = row.summary_deletions ?? 0
    const text = `Changed ${files} files (+${additions}/-${deletions})`

    const chunks = sessions.get(row.id) || []
    chunks.push({
      chunk_id: `${row.id}_files_${row.time_created}`,
      session_id: row.id,
      text,
      source: "file_change",
      metadata: {
        time_created: row.time_created,
        title: row.title,
        additions,
        deletions,
        diffs: row.summary_diffs,
      },
    })
    sessions.set(row.id, chunks)
  }

  return sessions
}
