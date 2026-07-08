export interface SessionChunk {
  chunk_id: string
  session_id: string
  text: string
  source: string
  metadata: Record<string, unknown>
  embedding_model?: string
}

export interface SessionChunkResult {
  chunk_id: string
  session_id: string
  text: string
  source: string
  metadata: Record<string, unknown>
  score: number
  rank: number
}

export interface VectorSearchConfig {
  baseUrl: string
}

const MAX_ERROR_BODY_BYTES = 4096

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    const snippet = text.slice(0, MAX_ERROR_BODY_BYTES)
    throw new Error(`HTTP ${response.status}: ${snippet}`)
  }

  return (await response.json()) as T
}

export async function indexSessionChunks(
  sessionId: string,
  chunks: SessionChunk[],
  config: VectorSearchConfig
): Promise<{ status: string; chunks_indexed: number }> {
  const url = `${config.baseUrl}/sessions/index`
  return postJson(url, {
    session_id: sessionId,
    chunks: chunks.map((c) => ({
      chunk_id: c.chunk_id,
      session_id: c.session_id,
      text: c.text,
      source: c.source,
      metadata: c.metadata,
      embedding_model: c.embedding_model || "all-MiniLM-L6-v2",
    })),
    embedding_model: "all-MiniLM-L6-v2",
  })
}

export async function querySessions(
  query: string,
  config: VectorSearchConfig,
  options: {
    sessionId?: string
    source?: string
    topK?: number
  } = {}
): Promise<SessionChunkResult[]> {
  const url = `${config.baseUrl}/sessions/query`
  const response = await postJson<{
    query: string
    results: SessionChunkResult[]
    total: number
  }>(url, {
    query,
    session_id: options.sessionId || null,
    source: options.source || null,
    embedding_model: "all-MiniLM-L6-v2",
    top_k: options.topK || 10,
  })
  return response.results
}

export async function getIndexedSessions(
  config: VectorSearchConfig
): Promise<string[]> {
  try {
    const response = await fetch(`${config.baseUrl}/sessions/indexed`)
    if (!response.ok) return []
    const data = (await response.json()) as { sessions?: string[] }
    return data.sessions || []
  } catch {
    return []
  }
}
