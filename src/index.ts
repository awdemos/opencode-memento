import type { Plugin } from "@opencode-ai/plugin"

interface SessionContextConfig {
  minSessions?: number
  searchLimit?: number
  includePatterns?: string[]
  excludePatterns?: string[]
  customContext?: string[]
}

const DEFAULT_CONFIG: Required<SessionContextConfig> = {
  minSessions: 5,
  searchLimit: 3,
  includePatterns: [],
  excludePatterns: ["node_modules", "dist", ".git"],
  customContext: [],
}

export const SessionContextPlugin: Plugin = async ({
  project,
  client,
  directory,
}) => {
  const config = await loadConfig(directory)
  const projectPath = directory
  const sessionCount = await getSessionCount(projectPath)
  const isActive = sessionCount >= config.minSessions

  if (isActive) {
    await client.app.log({
      body: {
        service: "opencode-session-context",
        level: "info",
        message: `Session context injection active (${sessionCount} prior sessions)`,
      },
    })
  }

  return {
    "experimental.session.compacting": async (input, output) => {
      if (!isActive) return

      const contextSections: string[] = [
        "## Session Context (from opencode-session-context)",
        "",
      ]

      const recentSessions = await getRecentSessions(projectPath, config.searchLimit)
      if (recentSessions.length > 0) {
        contextSections.push("### Recent Sessions", "")
        recentSessions.forEach((session) => {
          contextSections.push(
            `- ${session.id} (${session.date}): ${session.summary || "No summary"}`
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

      output.context.push(contextSections.join("\n"))

      await client.app.log({
        body: {
          service: "opencode-session-context",
          level: "debug",
          message: "Injected session context into compaction",
          extra: { sessionCount, sectionsCount: contextSections.length },
        },
      })
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
  summary?: string
}

async function getSessionCount(projectPath: string): Promise<number> {
  try {
    const sessionsDir = `${process.env.HOME}/.local/share/opencode/sessions`
    const glob = new Bun.Glob("**/*.json")
    let count = 0

    for await (const file of glob.scan({ cwd: sessionsDir })) {
      try {
        const content = await Bun.file(`${sessionsDir}/${file}`).text()
        if (content.includes(projectPath)) count++
      } catch {
        continue
      }
    }

    return count
  } catch {
    return 0
  }
}

async function getRecentSessions(
  projectPath: string,
  limit: number
): Promise<SessionSummary[]> {
  try {
    const sessionsDir = `${process.env.HOME}/.local/share/opencode/sessions`
    const glob = new Bun.Glob("**/*.json")
    const sessions: SessionSummary[] = []

    for await (const file of glob.scan({ cwd: sessionsDir })) {
      try {
        const content = await Bun.file(`${sessionsDir}/${file}`).text()
        if (!content.includes(projectPath)) continue

        const data = JSON.parse(content)
        sessions.push({
          id: data.id || file.replace(".json", ""),
          date: data.createdAt || data.updatedAt || "Unknown",
          summary: data.summary || data.title,
        })
      } catch {
        continue
      }
    }

    return sessions.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
  } catch {
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
