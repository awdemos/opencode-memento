# opencode-memento

> Preserve project context across OpenCode sessions by injecting relevant prior work into compaction.

> **Disclaimer**: This plugin is not affiliated with, endorsed by, or officially supported by OpenCode. It is a third-party community plugin.

## Why?

OpenCode sessions can lose context when compacted, especially on projects with extensive prior work. This plugin:

1. **Detects high-activity projects** - Identifies projects with significant session history
2. **Searches prior sessions** - Finds relevant past conversations matching current context
3. **Injects into compaction** - Ensures critical project knowledge survives session compaction

> ⚠️ **Experimental**: This plugin uses the `experimental.session.compacting` hook. The hook's behavior may change in future OpenCode versions. The plugin logs a warning on startup.

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
  "includePatterns": ["*.md", "*.ts", "*.go"],
  "excludePatterns": ["node_modules", "dist"],
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
| `includePatterns` | `[]` | File patterns to prioritize in context |
| `excludePatterns` | `[]` | Patterns to ignore |
| `customContext` | `[]` | Static context lines to always include |
| `dbPath` | `~/.local/share/opencode/opencode.db` | Path to OpenCode SQLite database |

**Note**: The `dbPath` supports `~` expansion. Adjust for your OS or custom OpenCode config location.
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

### Recent Sessions
- ses_abc123 (Feb 22): Implemented JWT auth middleware
- ses_def456 (Feb 21): Refactored API error handling  
- ses_ghi789 (Feb 20): Added rate limiting to endpoints

### Key Patterns from Prior Work
- ESLint configured - follow linting rules
- Prettier configured - use for formatting
- See AGENTS.md for anti-patterns to avoid

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
