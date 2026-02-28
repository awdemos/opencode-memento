import type { Plugin } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"

interface SessionContextConfig {
  minSessions?: number
  searchLimit?: number
  includePatterns?: string[]
  excludePatterns?: string[]
  customContext?: string[]
  dbPath?: string
}

const DEFAULT_CONFIG: Required<SessionContextConfig> = {
  minSessions: 5,
  searchLimit: 3,
  includePatterns: [],
  excludePatterns: ["node_modules", "dist", ".git"],
  customContext: [],
  dbPath: `${process.env.HOME}/.local/share/opencode/opencode.db`,
}

export const SessionContextPlugin: Plugin = async ({
  project,
  client,
  directory,
}) => {
  const config = await loadConfig(directory)
  const projectPath = directory

  await client.app.log({
    body: {
      service: "opencode-memento",
      level: "warn",
      message: "Using experimental session.compacting hook - behavior may change",
      extra: { hook: "experimental.session.compacting" },
    },
  })

  const sessionCount = await getSessionCount(projectPath, config.dbPath)
  const isActive = sessionCount >= config.minSessions

  if (isActive) {
    await client.app.log({
      body: {
        service: "opencode-memento",
        level: "info",
        message: `Session context injection active (${sessionCount} prior sessions)`,
        extra: { dbPath: config.dbPath },
      },
    })
  }

  return {
    "experimental.session.compacting": async (input, output) => {
      if (!isActive) return

      const contextSections: string[] = [
        "## Session Context (from opencode-memento)",
        "",
      ]

      const recentSessions = await getRecentSessions(
        projectPath,
        config.dbPath,
        config.searchLimit
      )
      if (recentSessions.length > 0) {
        contextSections.push("### Recent Sessions", "")
        recentSessions.forEach((session) => {
          contextSections.push(
            `- ${session.id} (${session.date}): ${session.title || "No title"}`
          )
        })
        contextSections.push("")
      }

      const patterns = await discoverPatterns(projectPath, config)
      if (patterns.length > 0) {
        contextSections.push("### Key Patterns from Prior Work", "")
        patterns.forEach((pattern) => contextSections.push(`- ${pattern}`))
        contextSections.push("")
      }

      if (config.customContext.length > 0) {
        contextSections.push("### Project-Specific Notes", "")
        config.customContext.forEach((line) => contextSections.push(line))
        contextSections.push("")
      }

      if (contextSections.length > 2) {
        output.context.push(contextSections.join("\n"))

        await client.app.log({
          body: {
            service: "opencode-memento",
            level: "debug",
            message: "Injected session context into compaction",
            extra: {
              sessionCount,
              sectionsCount: contextSections.length,
            },
          },
        })
      }
    },
  }
}

async function loadConfig(projectDir: string): Promise<Required<SessionContextConfig>> {
  try {
    const configPath = `${projectDir}/.opencode/session-context.json`
    const config = await Bun.file(configPath).json()
    return { ...DEFAULT_CONFIG, ...config }
  } catch {
    return DEFAULT_CONFIG
  }
}

interface SessionSummary {
  id: string
  date: string
  title?: string
}

function getDb(dbPath: string): Database | null {
  try {
    const db = new Database(dbPath, { readonly: true, create: false })
    return db
  } catch (error) {
    return null
  }
}

async function getSessionCount(
  projectPath: string,
  dbPath: string
): Promise<number> {
  try {
    const db = getDb(dbPath)
    if (!db) {
      return 0
    }

    const query = db.query<number, [string]>(
      "SELECT COUNT(*) as count FROM session WHERE directory = ?"
    )
    const count = query.get(projectPath) ?? 0
    db.close()
    return count
  } catch (error) {
    console.warn(
      `[opencode-memento] Error counting sessions:`,
      error instanceof Error ? error.message : String(error)
    )
    return 0
  }
}

async function getRecentSessions(
  projectPath: string,
  dbPath: string,
  limit: number
): Promise<SessionSummary[]> {
  try {
    const db = getDb(dbPath)
    if (!db) {
      return []
    }

    const query = db.query<
      { id: string; title: string; time_created: number },
      [string, number]
    >(
      "SELECT id, title, time_created FROM session WHERE directory = ? ORDER BY time_created DESC LIMIT ?"
    )

    const rows = query.all(projectPath, limit)
    db.close()

    return rows.map((row) => ({
      id: row.id,
      date: new Date(row.time_created).toISOString().split("T")[0],
      title: row.title,
    }))
  } catch (error) {
    console.warn(
      `[opencode-memento] Error getting recent sessions:`,
      error instanceof Error ? error.message : String(error)
    )
    return []
  }
}

async function discoverPatterns(
  projectPath: string,
  config: Required<SessionContextConfig>
): Promise<string[]> {
  const patterns: string[] = []

  try {
    const agentsPath = `${projectPath}/AGENTS.md`
    const agentsContent = await Bun.file(agentsPath).text()

    const conventionsMatch = agentsContent.match(/## Conventions\n([\s\S]*?)(?=\n##|$)/)
    if (conventionsMatch) {
      const lines = conventionsMatch[1]
        .split("\n")
        .filter((line) => line.trim().startsWith("-"))
        .slice(0, 5)
      patterns.push(...lines.map((l) => l.trim().replace(/^- /, "")))
    }

    const antiPatternsMatch = agentsContent.match(/## Anti-Patterns[\s\S]*?\n([\s\S]*?)(?=\n##|$)/)
    if (antiPatternsMatch) {
      patterns.push("See AGENTS.md for anti-patterns to avoid")
    }
  } catch {}

  const eslintExists =
    await Bun.file(`${projectPath}/.eslintrc.json`).exists() ||
    await Bun.file(`${projectPath}/.eslintrc.js`).exists()
  if (eslintExists) patterns.push("ESLint configured - follow linting rules")

  const prettierExists =
    await Bun.file(`${projectPath}/.prettierrc`).exists() ||
    await Bun.file(`${projectPath}/.prettierrc.json`).exists()
  if (prettierExists) patterns.push("Prettier configured - use for formatting")

  return patterns
}

export default SessionContextPlugin
