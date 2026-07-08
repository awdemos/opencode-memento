import { readFile } from "fs/promises"
import type { SessionContextConfig } from "./config"

function extractBullets(
  content: string,
  headings: string[],
  limit: number
): string[] {
  for (const heading of headings) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(`## ${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`)
    const match = content.match(regex)
    if (match) {
      return match[1]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("-") || line.startsWith("*"))
        .slice(0, limit)
        .map((line) => line.replace(/^[-*]\s*/, ""))
    }
  }
  return []
}

function extractBoundaries(content: string, maxPatterns: number): string[] {
  const patterns: string[] = []
  const boundariesMatch = content.match(
    /## Boundaries\s*\r?\n([\s\S]*?)(?=\r?\n## |$)/
  )
  if (!boundariesMatch) return patterns

  const lines = boundariesMatch[1].split(/\r?\n/)
  let category = ""
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith("### ")) {
      category = line
        .replace(/^###\s*/, "")
        .replace(/^[✅⚠️🚫]\s*/u, "")
        .trim()
    } else if ((line.startsWith("-") || line.startsWith("*")) && category) {
      const item = line.replace(/^[-*]\s*/, "")
      patterns.push(`[Boundary: ${category}] ${item}`)
    }
    if (patterns.length >= maxPatterns) break
  }
  return patterns
}

export async function discoverPatterns(
  projectPath: string,
  config: Required<SessionContextConfig>
): Promise<string[]> {
  const patterns: string[] = []

  const instructionPaths = [
    `${projectPath}/AGENTS.md`,
    `${projectPath}/CLAUDE.md`,
    `${projectPath}/.cursorrules`,
    `${projectPath}/.github/copilot-instructions.md`,
  ]

  let instructionsContent: string | null = null
  for (const path of instructionPaths) {
    try {
      instructionsContent = await readFile(path, "utf-8")
      break
    } catch (error) {
      console.debug(
        `[opencode-memento] Failed to read ${path}:`,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  if (!instructionsContent) {
    return patterns
  }

  const sections = [
    {
      key: "commands" as const,
      headings: ["Key Commands", "Common commands", "Commands"],
      prefix: "Command",
    },
    {
      key: "conventions" as const,
      headings: ["Conventions"],
      prefix: "Convention",
    },
    {
      key: "antiPatterns" as const,
      headings: ["Anti-Patterns"],
      prefix: "Anti-Pattern",
    },
    {
      key: "testing" as const,
      headings: ["Testing Rules", "Testing Guidelines", "Test Commands"],
      prefix: "Testing",
    },
    {
      key: "nonObvious" as const,
      headings: ["Non-Obvious Patterns", "Patterns", "Gotchas"],
      prefix: "Pattern",
    },
  ]

  const extracted = {
    boundaries: extractBoundaries(instructionsContent, config.maxPatterns),
    commands: extractBullets(
      instructionsContent,
      sections[0].headings,
      config.maxPatterns
    ),
    conventions: extractBullets(
      instructionsContent,
      sections[1].headings,
      config.maxPatterns
    ),
    antiPatterns: extractBullets(
      instructionsContent,
      sections[2].headings,
      config.maxPatterns
    ),
    testing: extractBullets(
      instructionsContent,
      sections[3].headings,
      config.maxPatterns
    ),
    nonObvious: extractBullets(
      instructionsContent,
      sections[4].headings,
      config.maxPatterns
    ),
  }

  for (const section of sections) {
    if (patterns.length >= config.maxPatterns) break
    const items = extracted[section.key]
    const remaining = config.maxPatterns - patterns.length
    patterns.push(
      ...items.slice(0, remaining).map((item) => `[${section.prefix}] ${item}`)
    )
  }

  const boundaryLimit = Math.min(extracted.boundaries.length, config.maxPatterns)
  const boundaryItems = extracted.boundaries.slice(0, boundaryLimit)
  return [
    ...boundaryItems,
    ...patterns.slice(0, config.maxPatterns - boundaryItems.length),
  ]
}
