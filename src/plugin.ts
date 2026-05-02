import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./config"
import {
  getSessionCount,
  getRecentSessions,
  getErrorPatterns,
  getTodos,
  getDecisions,
  getFileChanges,
} from "./db"
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

      if (config.enableErrorPatterns) {
        const errors = getErrorPatterns(
          projectPath,
          config.dbPath,
          config.maxErrors
        )
        if (errors.length > 0) {
          hasContent = true
          contextSections.push("### Known Issues & Errors", "")
          errors.forEach((err) => {
            const title = err.sessionTitle ? ` [${err.sessionTitle}]` : ""
            contextSections.push(`- ${err.error}${title} (${err.date})`)
          })
          contextSections.push("")
        }
      }

      if (config.enableTodos) {
        const todos = getTodos(projectPath, config.dbPath, config.maxTodos)
        if (todos.length > 0) {
          hasContent = true
          contextSections.push("### Outstanding TODOs", "")
          todos.forEach((todo) => {
            const title = todo.sessionTitle ? ` [${todo.sessionTitle}]` : ""
            contextSections.push(`- ${todo.todo}${title} (${todo.date})`)
          })
          contextSections.push("")
        }
      }

      if (config.enableDecisions) {
        const decisions = getDecisions(
          projectPath,
          config.dbPath,
          config.maxDecisions
        )
        if (decisions.length > 0) {
          hasContent = true
          contextSections.push("### Recent Decisions", "")
          decisions.forEach((decision) => {
            const title = decision.sessionTitle
              ? ` [${decision.sessionTitle}]`
              : ""
            contextSections.push(
              `- ${decision.decision}${title} (${decision.date})`
            )
          })
          contextSections.push("")
        }
      }

      if (config.enableFileChanges) {
        const changes = getFileChanges(
          projectPath,
          config.dbPath,
          config.maxFileChanges
        )
        if (changes.length > 0) {
          hasContent = true
          contextSections.push("### Recent File Changes", "")
          changes.forEach((change) => {
            const title = change.sessionTitle
              ? ` [${change.sessionTitle}]`
              : ""
            const stats = `+${change.additions}/-${change.deletions} in ${change.files} files`
            contextSections.push(
              `- ${stats}${title} (${change.date})`
            )
          })
          contextSections.push("")
        }
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
