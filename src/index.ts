export { SessionContextPlugin, default } from "./plugin"
export type { SessionContextConfig } from "./config"
export { DEFAULT_CONFIG, loadConfig } from "./config"
export { getDb, getSessionCount, getRecentSessions } from "./db"
export type { SessionSummary } from "./db"
export { discoverPatterns } from "./patterns"
export { querySessions, indexSessionChunks, getIndexedSessions } from "./vector-client"
export type { SessionChunk, SessionChunkResult, VectorSearchConfig } from "./vector-client"
export {
  extractSessionMessages,
  extractSessionTodos,
  extractSessionErrors,
  extractSessionDecisions,
  extractSessionFileChanges,
} from "./indexer"
