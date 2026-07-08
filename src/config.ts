import { readFile } from "fs/promises"
import { homedir } from "os"
import { join } from "path"
import type { SkillCategory } from "./skills/types"

export interface SessionContextConfig {
  minSessions?: number
  searchLimit?: number
  maxPatterns?: number
  maxCustomContextLines?: number
  customContext?: string[]
  dbPath?: string
  enableErrorPatterns?: boolean
  enableTodos?: boolean
  enableDecisions?: boolean
  enableFileChanges?: boolean
  maxErrors?: number
  maxTodos?: number
  maxDecisions?: number
  maxFileChanges?: number
  vectorSearchUrl?: string
  enableVectorSearch?: boolean
  enableSkillMemory?: boolean
  maxSkills?: number
  skillConfidenceThreshold?: number
  autoPromoteSkills?: boolean
  maxReflectionCandidates?: number
  skills?: Array<{
    category: SkillCategory
    content: string
    trigger?: string[]
  }>
}

export const DEFAULT_CONFIG: Required<SessionContextConfig> = {
  minSessions: 5,
  searchLimit: 3,
  maxPatterns: 12,
  maxCustomContextLines: 20,
  customContext: [],
  dbPath: "~/.local/share/opencode/opencode.db",
  enableErrorPatterns: true,
  enableTodos: true,
  enableDecisions: true,
  enableFileChanges: true,
  maxErrors: 5,
  maxTodos: 5,
  maxDecisions: 5,
  maxFileChanges: 3,
  vectorSearchUrl: "http://localhost:8001",
  enableVectorSearch: false,
  enableSkillMemory: false,
  maxSkills: 5,
  skillConfidenceThreshold: 0.3,
  autoPromoteSkills: false,
  maxReflectionCandidates: 3,
  skills: [],
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
  if (typeof config.enableErrorPatterns === "boolean") result.enableErrorPatterns = config.enableErrorPatterns
  if (typeof config.enableTodos === "boolean") result.enableTodos = config.enableTodos
  if (typeof config.enableDecisions === "boolean") result.enableDecisions = config.enableDecisions
  if (typeof config.enableFileChanges === "boolean") result.enableFileChanges = config.enableFileChanges
  if (typeof config.maxErrors === "number") result.maxErrors = config.maxErrors
  if (typeof config.maxTodos === "number") result.maxTodos = config.maxTodos
  if (typeof config.maxDecisions === "number") result.maxDecisions = config.maxDecisions
  if (typeof config.maxFileChanges === "number") result.maxFileChanges = config.maxFileChanges
  if (typeof config.vectorSearchUrl === "string") result.vectorSearchUrl = config.vectorSearchUrl
  if (typeof config.enableVectorSearch === "boolean") result.enableVectorSearch = config.enableVectorSearch
  if (typeof config.enableSkillMemory === "boolean") result.enableSkillMemory = config.enableSkillMemory
  if (typeof config.maxSkills === "number") result.maxSkills = config.maxSkills
  if (typeof config.skillConfidenceThreshold === "number") result.skillConfidenceThreshold = config.skillConfidenceThreshold
  if (typeof config.autoPromoteSkills === "boolean") result.autoPromoteSkills = config.autoPromoteSkills
  if (typeof config.maxReflectionCandidates === "number") result.maxReflectionCandidates = config.maxReflectionCandidates
  if (Array.isArray(config.skills)) {
    result.skills = config.skills.filter(
      (s): s is { category: SkillCategory; content: string; trigger?: string[] } =>
        s !== null &&
        typeof s === "object" &&
        typeof (s as Record<string, unknown>).category === "string" &&
        typeof (s as Record<string, unknown>).content === "string"
    )
  }

  return result
}

async function tryLoadConfig(path: string): Promise<Partial<SessionContextConfig> | null> {
  try {
    const raw = JSON.parse(await readFile(path, "utf-8"))
    return validateConfig(raw)
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    ) {
      return null
    }
    throw error
  }
}

function resolveDbPath(config: Required<SessionContextConfig>): Required<SessionContextConfig> {
  if (config.dbPath.startsWith("~")) {
    config.dbPath = config.dbPath.replace(/^~/, homedir())
  }
  return config
}

export async function loadConfig(
  projectDir: string
): Promise<Required<SessionContextConfig>> {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
    ? process.env.XDG_CONFIG_HOME
    : join(homedir(), ".config")

  const globalPath = join(xdgConfigHome, "opencode", "session-context.json")
  const localPath = join(projectDir, ".opencode", "session-context.json")

  const globalConfig = (await tryLoadConfig(globalPath)) ?? {}
  const localConfig = (await tryLoadConfig(localPath)) ?? {}

  return resolveDbPath({ ...DEFAULT_CONFIG, ...globalConfig, ...localConfig })
}
