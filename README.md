# opencode-memento

> Preserve project context across OpenCode sessions by injecting relevant prior work into compaction.

> **Disclaimer**: This plugin is not affiliated with, endorsed by, or officially supported by OpenCode. It is a third-party community plugin.

## Why?

OpenCode sessions can lose context when compacted, especially on projects with extensive prior work. This plugin:

1. **Detects high-activity projects** - Identifies projects with significant session history
2. **Searches prior sessions** - Finds relevant past conversations matching current context
3. **Injects into compaction** - Ensures critical project knowledge survives session compaction

> ⚠️ **Experimental**: This plugin uses the `experimental.session.compacting` hook. The hook's behavior may change in future OpenCode versions. The plugin logs a warning on startup.

## How It Works

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
  "plugin": ["opencode-memento@0.1.0"]
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

**Note**: The `dbPath` supports `~` expansion. Adjust for your OS or custom OpenCode config location.
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
