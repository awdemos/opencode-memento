export type SkillCategory =
  | "Always"
  | "Never"
  | "Command"
  | "Convention"
  | "Boundary"
  | "Anti-Pattern"
  | "Testing"

export type SkillSource = "reflection" | "manual" | "promoted"

export interface SkillRecord {
  id: string
  category: SkillCategory
  trigger: string[]
  content: string
  source: SkillSource
  confidence: number
  useCount: number
  lastUsed?: string
  createdAt: string
  approved: boolean
}

export interface SkillRegistry {
  version: 1
  projectPath: string
  skills: SkillRecord[]
}

export interface SeededSkill {
  category: SkillCategory
  content: string
  trigger?: string[]
}

export interface ReflectableSession {
  id: string
  title?: string
  messages: string[]
  todos: string[]
  errors: string[]
  decisions: string[]
}