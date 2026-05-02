import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./config"
import { getSessionCount, getRecentSessions } from "./db"
import { discoverPatterns } from "./patterns"

export const SessionContextPlugin: Plugin = async ({
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

  const sessionCount = getSessionCount(projectPath, config.dbPath)
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
    "experimental.session.compacting": async (_input, output) => {
      if (!isActive) return

      const contextSections: string[] = [
        "## Session Context (from opencode-memento)",
        "",
      ]
      let hasContent = false

      const recentSessions = getRecentSessions(
        projectPath,
        config.dbPath,
        config.searchLimit
      )
      if (recentSessions.length > 0) {
        hasContent = true
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
        hasContent = true
        contextSections.push("### Key Patterns from Prior Work", "")
        patterns.forEach((pattern) => contextSections.push(`- ${pattern}`))
        contextSections.push("")
      }

      if (config.customContext.length > 0) {
        hasContent = true
        const limitedContext = config.customContext.slice(
          0,
          config.maxCustomContextLines
        )
        contextSections.push("### Project-Specific Notes", "")
        limitedContext.forEach((line) => contextSections.push(line))
        if (config.customContext.length > config.maxCustomContextLines) {
          contextSections.push(
            `... (${config.customContext.length - config.maxCustomContextLines} more lines truncated for token budget)`
          )
        }
        contextSections.push("")
      }

      if (hasContent) {
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

export default { id: "opencode-memento", server: SessionContextPlugin }
