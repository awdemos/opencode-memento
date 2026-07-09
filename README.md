# opencode-memento — OpenCode Plugin for Persistent Project Context & Session Memory

> **opencode-memento** is an OpenCode plugin that preserves project context across sessions. It injects relevant prior work into compaction using SQLite search, optional semantic vector retrieval, and pattern discovery from your session history.

> **Disclaimer**: This plugin is not affiliated with, endorsed by, or officially supported by OpenCode. It is a third-party community plugin.

## Features

- **Project-aware context injection** - Detects active projects and injects relevant prior session context into compaction.
- **SQLite-driven search (default)** - Queries your local OpenCode database for recent sessions, errors, TODOs, decisions, and file changes.
- **Semantic vector search (optional)** - Uses [rag-params-finder](https://github.com/neomatrix369/rag-params-finder) for conceptually related matches, with automatic fallback to SQLite.
- **Pattern discovery** - Surfaces recurring commands, conventions, boundaries, and anti-patterns from prior work.
- **Skill memory (experimental)** - Proposes reusable project skills from your session history, lets you seed them manually, and can promote stable skills to your project instruction files.
- **Custom context** - Inject static project notes and per-project configuration via `.opencode/session-context.json`.

## Why?

OpenCode sessions can lose context when compacted, especially on projects with extensive prior work. This plugin:

1. **Detects high-activity projects** - Identifies projects with significant session history
2. **Searches prior sessions** - Finds relevant past conversations matching current context
3. **Injects into compaction** - Ensures critical project knowledge survives session compaction

> ⚠️ **Experimental**: This plugin uses the `experimental.session.compacting` hook. The hook's behavior may change in future OpenCode versions. The plugin logs a warning on startup.

## How It Works

### Default Mode (SQLite)

```
┌─────────────────────────────────────────────────────────┐
│                    Session Created                       │
└────────────────────────┬────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Plugin checks: How many prior sessions on this project?│
└────────────────────────┬────────────────────────────────┘
                          │
            ┌─────────────┴─────────────┐
            │                           │
      < minSessions               >= minSessions
            │                           │
            ▼                           ▼
       No injection         ┌──────────────────────┐
                            │  Search recent       │
                            │  sessions for        │
                            │  relevant context    │
                            └──────────┬───────────┘
                                       │
                                       ▼
                            ┌──────────────────────┐
                            │  On compaction:      │
                            │  Inject discovered   │
                            │  context + custom    │
                            └──────────────────────┘
```

### Vector Search Mode (Recommended)

When `enableVectorSearch` is enabled, the plugin uses **semantic search** instead of SQLite `LIKE` queries:

```
┌─────────────────────────────────────────────────────────┐
│                    Session Created                       │
└────────────────────────┬────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  First compaction: Extract & index all prior sessions   │
│  into vector store (rag-params-finder)                  │
└────────────────────────┬────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  On each compaction:                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  "errors"   │  │   "todos"   │  │ "decisions" │   │
│  │  semantic   │  │  semantic   │  │  semantic   │   │
│  │   search    │  │   search    │  │   search    │   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │
│         │                │                │           │
│         └────────────────┴────────────────┘           │
│                          │                            │
│                          ▼                            │
│              ┌─────────────────────┐                  │
│              │  Inject top results │                  │
│              │   into compaction   │                  │
│              └─────────────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

**Why semantic search?** Instead of matching exact keywords, it finds conceptually related content. A query like "authentication problem" will find sessions about "JWT token failure" or "login bug" even if those exact words weren't used.

## Installation

### Option 1: npm (Recommended)

Once published, install directly:

```json
{
  "plugin": ["opencode-memento"]
}
```

Or with version pinning:

```json
{
  "plugin": ["opencode-memento@1.0.0"]
}
```

### Option 2: Local Development

Clone this repo and reference it with an absolute path:

```json
{
  "plugin": ["/path/to/opencode-memento"]
}
```

> **Note**: Use an absolute path (e.g., `/Users/you/code/opencode-memento`), not a relative path like `./opencode-memento`. Relative paths resolve from the config file location (`~/.config/opencode/`), not your home directory.

### Option 3: file:// URL

Alternatively, use the `file://` protocol:

```json
{
  "plugin": ["file:///Users/you/code/opencode-memento"]
}
```

## Verifying Installation

After adding the plugin, restart OpenCode and check the startup logs:

```bash
# Check if the plugin loaded
cat ~/.local/share/opencode/log/*.log | grep -i memento
```

You should see:
```
service=plugin path=opencode-memento loading plugin
service=opencode-memento hook=experimental.session.compacting Using experimental session.compacting hook
```

If you see an error like `Cannot find module`, verify your config:

```bash
cat ~/.config/opencode/opencode.json | grep -A2 plugin
```

## Configuration (Optional)

Create `.opencode/session-context.json` in your project root to customize behavior:

```json
{
  "minSessions": 5,
  "searchLimit": 3,
  "customContext": [
    "## Project-Specific Notes",
    "- Always follow existing patterns in src/",
    "- Never commit .env files"
  ],
  "dbPath": "~/.local/share/opencode/opencode.db"
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `minSessions` | `5` | Minimum sessions before context injection activates |
| `searchLimit` | `3` | Max prior sessions to reference |
| `maxPatterns` | `12` | Max AGENTS.md patterns to inject (token budget) |
| `maxCustomContextLines` | `20` | Max custom context lines to inject |
| `customContext` | `[]` | Static context lines to always include |
| `dbPath` | `~/.local/share/opencode/opencode.db` | Path to OpenCode SQLite database |
| `enableErrorPatterns` | `true` | Extract error/failure patterns from session messages |
| `enableTodos` | `true` | Extract TODO/FIXME items from session messages |
| `enableDecisions` | `true` | Extract architectural decisions from session messages |
| `enableFileChanges` | `true` | Show recent file change summaries |
| `maxErrors` | `5` | Max error patterns to include |
| `maxTodos` | `5` | Max TODO items to include |
| `maxDecisions` | `5` | Max decisions to include |
| `maxFileChanges` | `3` | Max file change summaries to include |
| `enableVectorSearch` | `false` | Enable semantic search via rag-params-finder |
| `vectorSearchUrl` | `http://localhost:8001` | URL of the rag-params-finder API |
| `enableSkillMemory` | `false` | Enable the skill-memory subsystem |
| `maxSkills` | `5` | Max skills to inject into compaction |
| `skillConfidenceThreshold` | `0.3` | Minimum relevance score for a skill to be injected |
| `autoPromoteSkills` | `false` | Append high-confidence skills to instruction files automatically |
| `skills` | `[]` | Manually seeded skills |
| `maxReflectionCandidates` | `3` | Max unapproved reflection candidates per session |

**Note**: The `dbPath` supports `~` expansion. Adjust for your OS or custom OpenCode config location.

## Vector Search Setup (Optional but Recommended)

For semantic search instead of keyword matching, run [rag-params-finder](https://github.com/neomatrix369/rag-params-finder) alongside OpenCode:

### 1. Start rag-params-finder

```bash
git clone https://github.com/neomatrix369/rag-params-finder.git
cd rag-params-finder

# Start MongoDB with vector search support
docker compose up -d

# Install dependencies
uv pip install -e ".[dev]"

# Start the API server
uvicorn server.main:app --reload --port 8001
```

### 2. Enable vector search in memento

Add to your `.opencode/session-context.json`:

```json
{
  "enableVectorSearch": true,
  "vectorSearchUrl": "http://localhost:8001"
}
```

### 3. How it works

On the **first compaction** after enabling:
- Extracts all message parts, TODOs, errors, decisions, and file changes from your OpenCode SQLite database
- Chunks and indexes them into the vector store via `POST /sessions/index`
- Tracks which sessions are already indexed to avoid re-indexing

On **each subsequent compaction**:
- Queries the vector store with semantic search for errors, TODOs, and decisions
- Falls back to SQLite `LIKE` queries if the vector search is unavailable
- Results are deduplicated and ranked by relevance score

### Vector Search vs SQLite

| Feature | SQLite (Default) | Vector Search |
|---------|-----------------|---------------|
| Matching | Exact keyword (`LIKE '%error%'`) | Semantic (conceptually related) |
| Find "auth bug" | Only matches "auth" or "bug" | Finds "JWT failure", "login issue", "token problem" |
| Speed | Fast (local DB) | Network round-trip (~50-200ms) |
| Requires | Nothing | rag-params-finder + MongoDB |
| Fallback | N/A | Automatically falls back to SQLite if vector search fails |

## Skill Memory (Experimental)

When `enableSkillMemory` is true, the plugin maintains a local registry of reusable project skills at `.opencode/memento-skills.json`. It can:

- **Propose skills automatically** by reflecting on recent sessions for repeated TODOs, recurring errors, and explicit normative statements ("always", "never", "should").
- **Seed skills manually** through the `skills` array in `.opencode/session-context.json`.
- **Inject relevant skills** into compaction context under `### Memento Skills`.
- **Promote stable skills** to your project's instruction file (`AGENTS.md`, `CLAUDE.md`, etc.) when they reach high confidence and repeated use.

Enable it:

```json
{
  "enableSkillMemory": true,
  "maxSkills": 5,
  "autoPromoteSkills": false
}
```

Proposed skills are labeled `[Proposed]` until you approve them by editing the registry.

## Example Output

When a session is compacted, the plugin injects context like:

```markdown
## Session Context (from opencode-memento)

### Recent Sessions
- ses_abc123 (Feb 22): Implemented JWT auth middleware
- ses_def456 (Feb 21): Refactored API error handling  
- ses_ghi789 (Feb 20): Added rate limiting to endpoints

### Known Issues & Errors
- Type error in auth.ts: Argument of type 'string' is not assignable to parameter of type 'number' [JWT Auth] (Feb 22)
- npm test failing on Windows due to path separators [Testing] (Feb 21)

### Outstanding TODOs
- TODO: Add refresh token rotation strategy [JWT Auth] (Feb 22)
- FIXME: Handle edge case where user has no roles [Refactor] (Feb 21)

### Recent Decisions
- Decided to use httpOnly cookies instead of localStorage for token storage [JWT Auth] (Feb 22)
- Going with zod for input validation instead of joi [API Refactor] (Feb 21)

### Recent File Changes
- +450/-120 in 8 files [JWT Auth] (Feb 22)
- +200/-80 in 5 files [API Refactor] (Feb 21)

### Key Patterns from Prior Work
- [Command] Test all: `npm test`
- [Command] Typecheck: `npm run typecheck`
- [Convention] Use TypeScript for all new files
- [Boundary: Never] Commit secrets or `.env` files
- [Anti-Pattern] Using `any` instead of proper types

### Project-Specific Notes
- Always follow existing patterns in src/
- Never commit .env files
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   OpenCode      │────▶│  opencode-memento │────▶│  SQLite DB      │
│   (client)      │     │    (plugin)       │     │  (~/.local/...) │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
         ┌─────────────────┐      ┌──────────────────┐
         │  SQLite Queries │      │  Vector Search   │
         │  (LIKE matching)│      │  (semantic)      │
         │                 │      │                  │
         │  getErrors()    │      │  querySessions() │
         │  getTodos()     │      │  indexSession()  │
         │  getDecisions() │      │                  │
         └─────────────────┘      └────────┬─────────┘
                                           │
                                           ▼
                                 ┌──────────────────┐
                                 │ rag-params-finder│
                                 │   (FastAPI)      │
                                 │                  │
                                 │  MongoDB Atlas   │
                                 │  + $vectorSearch │
                                 └──────────────────┘
```

## Development

```bash
bun install
bun run build
bun run typecheck
```

## Publishing

```bash
bun run build
npm publish
```

## Contributing

PRs welcome! Feel free to open issues or submit pull requests.

## License

MIT

## Links

- [GitHub](https://github.com/awdemos/opencode-memento)
- [npm](https://www.npmjs.com/package/opencode-memento)
