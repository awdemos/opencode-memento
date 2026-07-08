# Leela-Style Agent Memory & Self-Improving Skills

## Status

Design approved. Ready for implementation planning.

## Context

`opencode-memento` is a TypeScript OpenCode plugin that preserves project context across sessions. It reads from OpenCode's local SQLite database and injects prior errors, TODOs, decisions, file changes, and instruction-file patterns into the `experimental.session.compacting` hook. This feature extends it with a **Leela/Hermes-style agent memory** subsystem: a skill registry that accumulates reusable project norms, reflects on session content to propose new skills, and lets users manually seed or promote skills into project instructions.

## Goals

1. Capture reusable project norms ("always run typecheck", "never commit secrets") as first-class **skills**.
2. **Reflect** on session content automatically and propose candidate skills when patterns repeat.
3. Allow users to **manually seed** skills via config.
4. **Inject** relevant skills into compaction context.
5. **Promote** stable, high-confidence skills back to the project's instruction files with user control.
6. Fail safely: reflection and injection must never break compaction.

## Non-Goals

- Full MCTS/self-play outcome optimization. We don't have a reliable session outcome signal from OpenCode.
- A separate CLI or UI. Skills are configured via JSON and promoted via project files.
- Rewriting the entire instruction file. We append to a dedicated `## Memento Skills` section.

## Data Model: `memento-skills.json`

Stored at `<projectPath>/.opencode/memento-skills.json`.

```ts
interface SkillRecord {
  id: string                    // stable slug, e.g. "always-run-typecheck"
  category: "Always" | "Never" | "Command" | "Convention" | "Boundary" | "Anti-Pattern" | "Testing"
  trigger: string[]             // keywords that activate this skill for injection
  content: string               // the actual instruction
  source: "reflection" | "manual" | "promoted"
  confidence: number            // 0.0 - 1.0
  useCount: number             // times injected
  lastUsed?: string            // ISO date
  createdAt: string             // ISO date
  approved: boolean            // manual = true; reflection = false until user edits
}

interface SkillRegistry {
  version: 1
  projectPath: string
  skills: SkillRecord[]
}
```

### Slug generation

```ts
function makeSkillId(category: string, content: string): string {
  const base = content.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
  return `${category.toLowerCase()}-${base}`
}
```

If the generated ID collides, append a short hash of the content.

## Configuration Additions

Add to `SessionContextConfig` and `DEFAULT_CONFIG`:

| Option | Default | Description |
|--------|---------|-------------|
| `enableSkillMemory` | `false` | Master switch for the skill subsystem |
| `maxSkills` | `5` | Max skills to inject into compaction |
| `skillConfidenceThreshold` | `0.3` | Minimum confidence for injection |
| `autoPromoteSkills` | `false` | If true, append high-confidence skills to instruction files automatically |
| `skills` | `[]` | Manually seeded skills (objects with `category`, `content`, optional `trigger`) |
| `maxReflectionCandidates` | `3` | Max unapproved reflection candidates to consider per session |

Manual seed example in `.opencode/session-context.json`:

```json
{
  "enableSkillMemory": true,
  "skills": [
    {
      "category": "Always",
      "content": "Run typecheck before claiming a fix is done.",
      "trigger": ["typecheck", "fix", "done"]
    }
  ]
}
```

## Components

### 1. `src/skills/registry.ts`

Responsibilities:
- Load and save `memento-skills.json`.
- Merge manual skills from config.
- Detect duplicate skills by normalized content and category.
- Provide ranked query for current context.
- Promote skills to instruction files.

Key functions:

```ts
export async function loadSkillRegistry(projectPath: string): Promise<SkillRegistry>
export async function saveSkillRegistry(registry: SkillRegistry): Promise<void>
export function mergeManualSkills(registry: SkillRegistry, skills: SeededSkill[]): SkillRegistry
export function selectSkillsForContext(
  registry: SkillRegistry,
  contextText: string,
  options: { maxSkills: number; threshold: number }
): SkillRecord[]
export async function promoteSkill(
  skill: SkillRecord,
  projectPath: string,
  options: { autoPromote: boolean }
): Promise<"promoted" | "pending" | "skipped">
```

### 2. `src/skills/reflection.ts`

Responsibilities:
- Scan session messages, TODOs, errors, and decisions for candidate norms.
- Propose skills only when a pattern repeats across ≥2 sessions or is stated explicitly.
- Avoid duplicates against the registry.

Candidate heuristics:
- Lines containing explicit normative markers: "always", "never", "should", "must not", "we always", "we never".
- Recurring TODOs/FIXMEs with the same normalized text across sessions.
- Recurring error patterns with the same root cause phrase.
- Recurring decision statements.

Each candidate starts with `approved: false`, `confidence: 0.3`, `source: "reflection"`, and `useCount: 0`.

```ts
export function reflectOnSessions(
  registry: SkillRegistry,
  sessions: ReflectableSession[],
  options: { maxCandidates: number }
): { candidates: SkillRecord[]; updated: SkillRecord[] }
```

### 3. `src/skills/injection.ts`

Responsibilities:
- Format selected skills into markdown lines for compaction.
- Separate `approved` from `[Proposed]` candidates.

```ts
export function formatSkillsSection(skills: SkillRecord[]): string[]
```

### 4. Integration in `src/plugin.ts`

In the `experimental.session.compacting` hook:
- After existing context sections, if `enableSkillMemory` is true:
  1. Load the skill registry.
  2. If this is the first compaction in the session, run reflection on recent sessions and update the registry.
  3. Select relevant skills using current session title/message text as context.
  4. If any approved or high-confidence proposed skills exist, inject a `### Memento Skills` section.
  5. Log injected count and any promotions.

Reflection should be rate-limited: no more than once per session, and only if `enableSkillMemory` is true and there is enough data.

### 5. Instruction file promotion

When a skill has `confidence >= 0.8`, `useCount >= 3`, and `source !== "promoted"`:
- If `autoPromoteSkills` is true, append it to the first available instruction file under `## Memento Skills`, then mark it `source: "promoted"` and `approved: true` in the registry.
- If `autoPromoteSkills` is false, log a suggestion at `info` level so the user sees it and can manually add it.

Promotion writes use the same file-selection order as `discoverPatterns`: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`. If none exist, do nothing.

## Data Flow

```
Session Created
       │
       ▼
Plugin loads config
       │
       ▼
Enable skill memory? ─No─► skip
       │ Yes
       ▼
Load .opencode/memento-skills.json
       │
       ▼
On first compaction in session:
  ┌─────────────────────────────┐
  │ Reflect on recent sessions  │
  │ (messages, todos, errors)   │
  │ Propose candidate skills    │
  │ Merge with registry         │
  └─────────────────────────────┘
       │
       ▼
Select skills relevant to current context
       │
       ▼
Inject "Memento Skills" section
       │
       ▼
Update useCount / lastUsed
       │
       ▼
Promote stable skills (optional)
```

## Error Handling

- Registry file missing: treat as empty registry, create on first write.
- Registry parse error: log warning, fall back to empty registry, do not overwrite until reflection succeeds.
- Reflection error: log with `client.app.log`, continue compaction.
- Promotion error: log warning, do not mark skill as promoted.
- Duplicate detection: normalized content + category. If a manual skill duplicates a reflection skill, prefer the manual one (approved=true).

## Ranking Formula

For context selection, compute a score per skill:

```ts
const recency = skill.lastUsed
  ? Math.max(0, 1 - (daysSince(skill.lastUsed) / 30))
  : 0.5
const engagement = Math.min(skill.useCount / 10, 1)
const relevance = tokenOverlap(skill.trigger, contextTokens) // 0..1
const score = skill.confidence * 0.5 + relevance * 0.3 + recency * 0.1 + engagement * 0.1
```

Only skills with `score >= skillConfidenceThreshold` are considered. Proposed (`approved: false`) skills are included only if they rank in the top `maxReflectionCandidates` and only when mixed with approved skills. The injected section clearly labels proposed skills with `[Proposed]`.

## Testing Plan

1. **Registry tests** (`tests/skills/registry.test.ts`)
   - Load/save roundtrip.
   - Duplicate merging.
   - Manual skill seeding.
   - Promotion logic with mocked instruction files.

2. **Reflection tests** (`tests/skills/reflection.test.ts`)
   - Candidate extraction from synthetic message rows.
   - Recurring pattern detection.
   - Duplicate suppression.

3. **Injection tests** (`tests/skills/injection.test.ts`)
   - Ranking and selection.
   - Formatting of approved vs proposed skills.

4. **Integration tests** (`tests/plugin.test.ts` or a new `tests/skills/plugin-integration.test.ts`)
   - Verify skill section appears in compaction output when enabled.
   - Verify reflection runs at most once per session.

## Open Questions (resolved during design)

- Skill persistence: internal registry + optional sync to instruction files. ✅
- Signal source: automatic reflection + manual seeding. ✅
- Integration path: inside existing plugin. ✅
- Skill definition: reusable prompt/behavior template. ✅

## Risks

1. **Reflection noise**: heuristics may propose low-quality skills. Mitigated by requiring repetition and starting candidates unapproved.
2. **Registry growth unbounded**: candidates accumulate. Mitigated by deduplication and a future pruning mechanism (out of scope for this design).
3. **Instruction file conflicts**: appending to markdown files is safe but may duplicate sections if users rename files. Promotion tracks `source: "promoted"` to avoid re-adding the same skill.
