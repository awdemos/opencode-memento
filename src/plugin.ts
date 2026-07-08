import type { Plugin } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"
import { loadConfig } from "./config"
import {
  getDb,
  getSessionCount,
  getRecentSessions,
  getErrorPatterns,
  getTodos,
  getDecisions,
  getFileChanges,
} from "./db"
import {
  extractSessionMessages,
  extractSessionTodos,
  extractSessionErrors,
  extractSessionDecisions,
  extractSessionFileChanges,
} from "./indexer"
import {
  querySessions,
  indexSessionChunks,
  getIndexedSessions,
} from "./vector-client"
import { discoverPatterns } from "./patterns"
import { formatSkillsSection } from "./skills/injection"
import {
  loadSkillRegistry,
  saveSkillRegistry,
  mergeManualSkills,
  selectSkillsForContext,
  promoteSkill,
} from "./skills/registry"
import { reflectOnSessions } from "./skills/reflection"
import type { ReflectableSession } from "./skills/types"

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

  const vectorConfig = { baseUrl: config.vectorSearchUrl }
  let sessionsIndexed = false

  let skillRegistry = await loadSkillRegistry(projectPath)
  skillRegistry = mergeManualSkills(skillRegistry, config.skills)
  let skillsReflected = false

  function gatherReflectableSessions(
    db: Database,
    limit: number
  ): ReflectableSession[] {
    const sessionQuery = db.query<
      { id: string; title: string | null; time_created: number },
      [string, number]
    >(
      "SELECT id, title, time_created FROM session WHERE directory = ? ORDER BY time_created DESC LIMIT ?"
    )
    const sessions = sessionQuery.all(projectPath, limit)

    const messageQuery = db.query<
      { session_id: string; text: string },
      [string]
    >(
      `SELECT m.session_id, json_extract(p.data, '$.text') as text
       FROM part p
       JOIN message m ON p.message_id = m.id
       JOIN session s ON m.session_id = s.id
       WHERE s.directory = ? AND json_extract(p.data, '$.type') IN ('text', 'reasoning')`
    )
    const todoQuery = db.query<
      { session_id: string; content: string },
      [string]
    >(
      `SELECT t.session_id, t.content
       FROM todo t
       JOIN session s ON t.session_id = s.id
       WHERE s.directory = ? AND t.status != 'completed'`
    )

    const messagesBySession = new Map<string, string[]>()
    for (const row of messageQuery.all(projectPath)) {
      const list = messagesBySession.get(row.session_id) || []
      if (row.text) list.push(String(row.text))
      messagesBySession.set(row.session_id, list)
    }

    const todosBySession = new Map<string, string[]>()
    for (const row of todoQuery.all(projectPath)) {
      const list = todosBySession.get(row.session_id) || []
      list.push(row.content)
      todosBySession.set(row.session_id, list)
    }

    return sessions.map((s) => ({
      id: s.id,
      title: s.title ?? undefined,
      messages: messagesBySession.get(s.id) || [],
      todos: todosBySession.get(s.id) || [],
      errors: [],
      decisions: [],
    }))
  }

  async function reflectOnce(): Promise<void> {
    if (skillsReflected || !config.enableSkillMemory) return
    const db = getDb(config.dbPath)
    if (!db) return

    try {
      const sessions = gatherReflectableSessions(db, Math.max(config.searchLimit * 2, 10))
      if (sessions.length === 0) return
      const { candidates, updated } = reflectOnSessions(skillRegistry, sessions, {
        maxCandidates: config.maxReflectionCandidates,
      })
      skillRegistry = { ...skillRegistry, skills: [...updated, ...candidates] }
      if (candidates.length > 0) {
        await client.app.log({
          body: {
            service: "opencode-memento",
            level: "info",
            message: `Proposed ${candidates.length} skill candidate(s) from session reflection`,
          },
        })
      }
      await saveSkillRegistry(skillRegistry)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[opencode-memento] Skill reflection failed: ${msg}`)
    } finally {
      db.close()
      skillsReflected = true
    }
  }

  async function ensureSessionsIndexed(): Promise<void> {
    if (sessionsIndexed || !config.enableVectorSearch) return

    const db = getDb(config.dbPath)
    if (!db) return

    try {
      const indexed = new Set(await getIndexedSessions(vectorConfig))
      const allMessages = extractSessionMessages(db, projectPath)
      const allTodos = extractSessionTodos(db, projectPath)
      const allErrors = extractSessionErrors(db, projectPath)
      const allDecisions = extractSessionDecisions(db, projectPath)
      const allFileChanges = extractSessionFileChanges(db, projectPath)

      const allSessionIds = new Set([
        ...allMessages.keys(),
        ...allTodos.keys(),
        ...allErrors.keys(),
        ...allDecisions.keys(),
        ...allFileChanges.keys(),
      ])

      let indexedCount = 0
      for (const sessionId of allSessionIds) {
        if (indexed.has(sessionId)) continue

        const chunks = [
          ...(allMessages.get(sessionId) || []),
          ...(allTodos.get(sessionId) || []),
          ...(allErrors.get(sessionId) || []),
          ...(allDecisions.get(sessionId) || []),
          ...(allFileChanges.get(sessionId) || []),
        ]

        if (chunks.length === 0) continue

        try {
          await indexSessionChunks(sessionId, chunks, vectorConfig)
          indexedCount++
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn(`[opencode-memento] Failed to index session ${sessionId}: ${msg}`)
        }
      }

      if (indexedCount > 0) {
        await client.app.log({
          body: {
            service: "opencode-memento",
            level: "info",
            message: `Indexed ${indexedCount} sessions for vector search`,
          },
        })
      }

      sessionsIndexed = true
    } finally {
      db.close()
    }
  }

  return {
    "experimental.session.compacting": async (_input, output) => {
      if (!isActive || !output || !Array.isArray(output.context)) return

      if (config.enableVectorSearch) {
        await ensureSessionsIndexed()
      }

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
        let errors: { sessionId: string; sessionTitle?: string; error: string; date: string }[] = []

        if (config.enableVectorSearch) {
          try {
            const results = await querySessions(
              "error failure exception bug problem crash broken",
              vectorConfig,
              { source: "error", topK: config.maxErrors * 2 }
            )
            const seen = new Set<string>()
            for (const r of results) {
              if (errors.length >= config.maxErrors) break
              const key = `${r.session_id}:${r.text}`
              if (!seen.has(key)) {
                seen.add(key)
                errors.push({
                  sessionId: r.session_id,
                  sessionTitle: r.metadata.title as string | undefined,
                  error: r.text,
                  date: new Date((r.metadata.time_created as number) || Date.now())
                    .toISOString().split("T")[0],
                })
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            console.warn(`[opencode-memento] Vector search for errors failed: ${msg}`)
          }
        }

        if (errors.length === 0) {
          const sqliteErrors = getErrorPatterns(projectPath, config.dbPath, config.maxErrors)
          errors = sqliteErrors
        }

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
        let todos: { sessionId: string; sessionTitle?: string; todo: string; date: string }[] = []

        if (config.enableVectorSearch) {
          try {
            const results = await querySessions(
              "todo task fixme pending work hack issue bug needs to be done",
              vectorConfig,
              { source: "todo", topK: config.maxTodos * 2 }
            )
            const seen = new Set<string>()
            for (const r of results) {
              if (todos.length >= config.maxTodos) break
              const key = `${r.session_id}:${r.text}`
              if (!seen.has(key)) {
                seen.add(key)
                todos.push({
                  sessionId: r.session_id,
                  sessionTitle: r.metadata.title as string | undefined,
                  todo: r.text,
                  date: new Date((r.metadata.time_created as number) || Date.now())
                    .toISOString().split("T")[0],
                })
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            console.warn(`[opencode-memento] Vector search for todos failed: ${msg}`)
          }
        }

        if (todos.length === 0) {
          const sqliteTodos = getTodos(projectPath, config.dbPath, config.maxTodos)
          todos = sqliteTodos
        }

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
        let decisions: { sessionId: string; sessionTitle?: string; decision: string; date: string }[] = []

        if (config.enableVectorSearch) {
          try {
            const results = await querySessions(
              "decided decision approach architecture choice chose going with we should",
              vectorConfig,
              { source: "decision", topK: config.maxDecisions * 2 }
            )
            const seen = new Set<string>()
            for (const r of results) {
              if (decisions.length >= config.maxDecisions) break
              const key = `${r.session_id}:${r.text}`
              if (!seen.has(key)) {
                seen.add(key)
                decisions.push({
                  sessionId: r.session_id,
                  sessionTitle: r.metadata.title as string | undefined,
                  decision: r.text,
                  date: new Date((r.metadata.time_created as number) || Date.now())
                    .toISOString().split("T")[0],
                })
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            console.warn(`[opencode-memento] Vector search for decisions failed: ${msg}`)
          }
        }

        if (decisions.length === 0) {
          const sqliteDecisions = getDecisions(projectPath, config.dbPath, config.maxDecisions)
          decisions = sqliteDecisions
        }

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

      try {
        const patterns = await discoverPatterns(projectPath, config)
        if (patterns.length > 0) {
          hasContent = true
          contextSections.push("### Key Patterns from Prior Work", "")
          patterns.forEach((pattern) => contextSections.push(`- ${pattern}`))
          contextSections.push("")
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(`[opencode-memento] Pattern discovery failed: ${msg}`)
      }

      if (config.enableSkillMemory) {
        await reflectOnce()

        const inputText =
          typeof _input === "object" && _input !== null
            ? JSON.stringify(_input)
            : String(_input ?? "")
        const contextText = [inputText, ...(output.context || [])].join(" ")
        const selected = selectSkillsForContext(skillRegistry, contextText, {
          maxSkills: config.maxSkills,
          threshold: config.skillConfidenceThreshold,
        })

        if (selected.length > 0) {
          hasContent = true
          contextSections.push(...formatSkillsSection(selected))

          const now = new Date().toISOString()
          const updatedSkills = skillRegistry.skills.map((skill) => {
            if (selected.some((s) => s.id === skill.id)) {
              return {
                ...skill,
                useCount: skill.useCount + 1,
                lastUsed: now,
              }
            }
            return skill
          })
          skillRegistry = { ...skillRegistry, skills: updatedSkills }

          for (const skill of selected) {
            const promotionResult = await promoteSkill(skill, projectPath, {
              autoPromote: config.autoPromoteSkills,
            })
            if (promotionResult === "pending") {
              await client.app.log({
                body: {
                  service: "opencode-memento",
                  level: "info",
                  message: `Skill "${skill.content}" is ready for promotion to instruction file`,
                },
              })
            }
          }

          await saveSkillRegistry(skillRegistry).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e)
            console.warn(`[opencode-memento] Failed to save skill registry: ${msg}`)
          })
        }
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
