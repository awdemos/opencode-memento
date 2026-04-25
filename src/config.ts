import { homedir } from "os"

export interface SessionContextConfig {
  minSessions?: number
  searchLimit?: number
  maxPatterns?: number
  maxCustomContextLines?: number
  customContext?: string[]
  dbPath?: string
}

export const DEFAULT_CONFIG: Required<SessionContextConfig> = {
  minSessions: 5,
  searchLimit: 3,
  maxPatterns: 12,
  maxCustomContextLines: 20,
  customContext: [],
  dbPath: "~/.local/share/opencode/opencode.db",
}

function validateConfig(raw: unknown): Partial<SessionContextConfig> {
  if (typeof raw !== "object" || raw === null) {
    return {}
  }
  const config = raw as Record<string, unknown>
  const result: Partial<SessionContextConfig> = {}

  if (typeof config.minSessions === "number") result.minSessions = config.minSessions
  if (typeof config.searchLimit === "number") result.searchLimit = config.searchLimit
  if (typeof config.maxPatterns === "number") result.maxPatterns = config.maxPatterns
  if (typeof config.maxCustomContextLines === "number") result.maxCustomContextLines = config.maxCustomContextLines
  if (Array.isArray(config.customContext)) result.customContext = config.customContext.filter((c): c is string => typeof c === "string")
  if (typeof config.dbPath === "string") result.dbPath = config.dbPath

  return result
}

export async function loadConfig(
  projectDir: string
): Promise<Required<SessionContextConfig>> {
  try {
    const configPath = `${projectDir}/.opencode/session-context.json`
    const raw = await Bun.file(configPath).json()
    const fileConfig = validateConfig(raw)
    const merged = { ...DEFAULT_CONFIG, ...fileConfig }
    if (merged.dbPath.startsWith("~")) {
      merged.dbPath = merged.dbPath.replace(/^~/, homedir())
    }
    return merged
  } catch (error) {
    console.debug(
      `[opencode-memento] Config load failed, using defaults:`,
      error instanceof Error ? error.message : String(error)
    )
    return {
      ...DEFAULT_CONFIG,
      dbPath: DEFAULT_CONFIG.dbPath.replace(/^~/, homedir()),
    }
  }
}
