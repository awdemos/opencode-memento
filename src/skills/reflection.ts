import { deriveTrigger, makeSkillId } from "./registry"
import type {
  ReflectableSession,
  SkillCategory,
  SkillRecord,
  SkillRegistry,
} from "./types"

const NORMATIVE_MARKERS = [
  {
    pattern: /\b(we\s+)?always\s+(.+?)(?:\.|$)/i,
    category: "Always" as SkillCategory,
  },
  {
    pattern: /\b(we\s+)?never\s+(.+?)(?:\.|$)/i,
    category: "Never" as SkillCategory,
  },
  {
    pattern: /\bshould\s+(.+?)(?:\.|$)/i,
    category: "Convention" as SkillCategory,
  },
  {
    pattern: /\bmust\s+not\s+(.+?)(?:\.|$)/i,
    category: "Never" as SkillCategory,
  },
]

function now(): string {
  return new Date().toISOString()
}

function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function extractNormativeStatements(
  text: string
): Array<{ category: SkillCategory; content: string }> {
  const results: Array<{ category: SkillCategory; content: string }> = []
  const sentences = text.split(/(?<=[.!?])\s+/)
  for (const sentence of sentences) {
    for (const { pattern, category } of NORMATIVE_MARKERS) {
      const match = sentence.match(pattern)
      if (match) {
        const raw = match[2] ?? match[1]
        if (raw && raw.length > 5) {
          const cleaned = raw
            .trim()
            .replace(/^\s*(always|never|should)\s+/i, "")
            .replace(/\s+/g, " ")
          results.push({
            category,
            content: cleaned,
          })
          break
        }
      }
    }
  }
  return results
}

function findRecurring<T>(
  items: T[],
  normalize: (item: T) => string,
  minOccurrences = 2
): T[] {
  const counts = new Map<string, { count: number; example: T }>()
  for (const item of items) {
    const key = normalize(item)
    if (key.length < 5) continue
    const existing = counts.get(key)
    if (existing) {
      existing.count++
    } else {
      counts.set(key, { count: 1, example: item })
    }
  }
  return Array.from(counts.values())
    .filter((entry) => entry.count >= minOccurrences)
    .map((entry) => entry.example)
}

function categorizeTodo(content: string): SkillCategory {
  const lower = content.toLowerCase()
  if (lower.includes("test") || lower.includes("spec")) return "Testing"
  if (lower.includes("fixme") || lower.includes("fix")) return "Anti-Pattern"
  return "Convention"
}

function categorizeError(): SkillCategory {
  return "Anti-Pattern"
}

function categorizeDecision(): SkillCategory {
  return "Convention"
}

export function reflectOnSessions(
  registry: SkillRegistry,
  sessions: ReflectableSession[],
  options: { maxCandidates: number }
): { candidates: SkillRecord[]; updated: SkillRecord[] } {
  const existingKeys = new Set(
    registry.skills.map((s) => `${s.category}:${normalizeContent(s.content)}`)
  )

  const allNormative: Array<{ category: SkillCategory; content: string }> = []
  const allTodos: string[] = []
  const allErrors: string[] = []
  const allDecisions: string[] = []

  for (const session of sessions) {
    for (const message of session.messages) {
      allNormative.push(...extractNormativeStatements(message))
    }
    allTodos.push(...session.todos)
    allErrors.push(...session.errors)
    allDecisions.push(...session.decisions)
  }

  const candidates: SkillRecord[] = []
  const updated: SkillRecord[] = [...registry.skills]

  function addOrUpdate(category: SkillCategory, content: string): void {
    const normalized = normalizeContent(content)
    const key = `${category}:${normalized}`
    const existingIndex = updated.findIndex(
      (s) => `${s.category}:${normalizeContent(s.content)}` === key
    )

    if (existingIndex >= 0) {
      const existing = updated[existingIndex]
      updated[existingIndex] = {
        ...existing,
        confidence: Math.min(1, existing.confidence + 0.1),
      }
      return
    }

    if (existingKeys.has(key)) return
    if (candidates.some((c) => `${c.category}:${normalizeContent(c.content)}` === key)) return

    candidates.push({
      id: makeSkillId(category, content),
      category,
      trigger: deriveTrigger(content),
      content,
      source: "reflection",
      confidence: 0.3,
      useCount: 0,
      createdAt: now(),
      approved: false,
    })
  }

  for (const { category, content } of allNormative) {
    addOrUpdate(category, content)
  }

  for (const todo of findRecurring(
    allTodos,
    (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  )) {
    addOrUpdate(categorizeTodo(todo), todo)
  }

  for (const error of findRecurring(
    allErrors,
    (e) => e.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  )) {
    addOrUpdate(categorizeError(), error)
  }

  for (const decision of findRecurring(
    allDecisions,
    (d) => d.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  )) {
    addOrUpdate(categorizeDecision(), decision)
  }

  return {
    candidates: candidates.slice(0, options.maxCandidates),
    updated,
  }
}
