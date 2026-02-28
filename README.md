# opencode-memento

> Preserve project context across OpenCode sessions by injecting relevant prior work into compaction.

> **Disclaimer**: This plugin is not affiliated with, endorsed by, or officially supported by OpenCode. It is a third-party community plugin.

## Why?

OpenCode sessions can lose context when compacted, especially on projects with extensive prior work. This plugin:

1. **Detects high-activity projects** - Identifies projects with significant session history
2. **Searches prior sessions** - Finds relevant past conversations matching current context
3. **Injects into compaction** - Ensures critical project knowledge survives session compaction

## Installation

Add to your OpenCode config:

```json
{
  "plugin": ["opencode-memento"]
}
```

Or for local development:

```json
{
  "plugin": ["./path/to/opencode-memento"]
}
```

## Configuration

Create `.opencode/session-context.json` in your project:

```json
{
  "minSessions": 10,
  "searchLimit": 3,
  "includePatterns": ["*.md", "*.ts", "*.go"],
  "excludePatterns": ["node_modules", "dist"],
  "customContext": [
    "## Project-Specific Notes",
    "- Always follow existing patterns in src/",
    "- Never commit .env files"
  ]
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `minSessions` | `5` | Minimum sessions before context injection activates |
| `searchLimit` | `3` | Max prior sessions to reference |
| `includePatterns` | `[]` | File patterns to prioritize in context |
| `excludePatterns` | `[]` | Patterns to ignore |
| `customContext` | `[]` | Static context lines to always include |

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

## Example Output

When a session is compacted, the plugin injects context like:

```markdown
## Session Context (from opencode-memento)

### Recent Work (3 sessions)
- ses_abc123 (Feb 22): Implemented JWT auth middleware
- ses_def456 (Feb 21): Refactored API error handling  
- ses_ghi789 (Feb 20): Added rate limiting to endpoints

### Key Patterns
- Error handling: Use `AppError` class from src/errors/
- Auth: Middleware chain in src/middleware/auth.ts
- Testing: Jest with supertest for API tests

### Project Notes
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
