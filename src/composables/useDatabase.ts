import Database from '@tauri-apps/plugin-sql';
import type { AIConfig } from '../stores/settings';
import type { Conversation, HistoryMessage } from '../stores/history';
import type { Project, ProjectTodo } from '../stores/projects';

let dbInstance: Database | null = null;

/**
 * Singleton database connection for the app.
 * Loads on first call and caches for reuse.
 */
async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;
  dbInstance = await Database.load('sqlite:ai_research_assistant.db');
  return dbInstance;
}

/**
 * Initialize the SQLite schema.
 * Creates tables if they do not already exist.
 */
export async function initDatabase(): Promise<void> {
  const db = await getDb();

  // Settings: single-row key-value store for app configuration
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Projects: research project workspaces
  await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      color       TEXT NOT NULL DEFAULT '#3d74e7',
      keywords    TEXT,
      folder_path TEXT,
      zotero_collection TEXT,
      obsidian_vault TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);

  // Conversations: chat sessions (with optional project_id)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      project_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Migrate: add project_id column if conversations table exists without it
  try {
    await db.execute(`ALTER TABLE conversations ADD COLUMN project_id TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Migrate: add summary column for conversation context injection (Phase 1.1)
  try {
    await db.execute(`ALTER TABLE conversations ADD COLUMN summary TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Messages: individual chat messages
  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  // Project todos: task items per project
  await db.execute(`
    CREATE TABLE IF NOT EXISTS project_todos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  TEXT NOT NULL,
      content     TEXT NOT NULL,
      priority    TEXT NOT NULL DEFAULT 'medium',
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // Activity events: user behavior tracking
  await db.execute(`
    CREATE TABLE IF NOT EXISTS activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      project_id TEXT,
      duration_ms INTEGER,
      resource_id TEXT,
      metadata TEXT
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_events_type ON activity_events(event_type)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_events_project ON activity_events(project_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_events_time ON activity_events(timestamp)`);

  // Usage records: AI model usage tracking for cost management
  await db.execute(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      task_type TEXT NOT NULL,
      project_id TEXT,
      model_name TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      latency_ms INTEGER,
      success INTEGER NOT NULL DEFAULT 1,
      is_fallback INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_records(timestamp)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_usage_task ON usage_records(task_type)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_records(model_name)`);

  // Knowledge base: documents and chunks for semantic search
  await db.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id          TEXT PRIMARY KEY,
      project_id  TEXT,
      file_path   TEXT NOT NULL,
      file_name   TEXT NOT NULL,
      file_type   TEXT,
      total_pages INTEGER,
      index_status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_kb_docs_project ON knowledge_docs(project_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_kb_docs_status ON knowledge_docs(index_status)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS doc_chunks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id      TEXT NOT NULL,
      content     TEXT NOT NULL,
      page_number INTEGER,
      chunk_index INTEGER NOT NULL,
      embedding   TEXT,
      created_at  INTEGER NOT NULL,
      FOREIGN KEY (doc_id) REFERENCES knowledge_docs(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON doc_chunks(doc_id)`);

  // Zotero cache: local mirror of Zotero library items
  await db.execute(`
    CREATE TABLE IF NOT EXISTS zotero_items_cache (
      id          INTEGER PRIMARY KEY,
      key         TEXT NOT NULL UNIQUE,
      item_type   TEXT NOT NULL,
      title       TEXT,
      creators    TEXT,
      abstract    TEXT,
      url         TEXT,
      doi         TEXT,
      date        TEXT,
      publication TEXT,
      tags        TEXT,
      collections TEXT,
      json_data   TEXT NOT NULL,
      version     INTEGER NOT NULL DEFAULT 0,
      synced_at   INTEGER NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_zotero_title ON zotero_items_cache(title)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_zotero_key ON zotero_items_cache(key)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_zotero_type ON zotero_items_cache(item_type)`);

  // Zotero collections cache
  await db.execute(`
    CREATE TABLE IF NOT EXISTS zotero_collections_cache (
      id          INTEGER PRIMARY KEY,
      key         TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      parent_key  TEXT,
      version     INTEGER NOT NULL DEFAULT 0,
      synced_at   INTEGER NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_zotero_coll_parent ON zotero_collections_cache(parent_key)`);
}

/* ───────────────────────────────────────────────
   Settings CRUD
   ─────────────────────────────────────────────── */

export async function loadSettings(): Promise<AIConfig | null> {
  const db = await getDb();
  const rows = await db.select<[{ value: string }]>(
    "SELECT value FROM settings WHERE key = 'ai_config'"
  );
  if (!rows.length) return null;
  try {
    return JSON.parse(rows[0].value) as AIConfig;
  } catch {
    return null;
  }
}

export async function saveSettings(config: AIConfig): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_config', ?)",
    [JSON.stringify(config)]
  );
}

/* ───────────────────────────────────────────────
   Project CRUD
   ─────────────────────────────────────────────── */

export async function loadProjects(): Promise<Project[]> {
  const db = await getDb();
  const rows = await db.select<
    { id: string; name: string; color: string; keywords: string | null; folder_path: string | null; zotero_collection: string | null; obsidian_vault: string | null; created_at: number; updated_at: number }[]
  >('SELECT * FROM projects ORDER BY updated_at DESC');

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    keywords: r.keywords ? JSON.parse(r.keywords) : [],
    folderPath: r.folder_path ?? undefined,
    zoteroCollection: r.zotero_collection ?? undefined,
    obsidianVault: r.obsidian_vault ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

export async function saveProject(project: Project): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO projects
     (id, name, color, keywords, folder_path, zotero_collection, obsidian_vault, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      project.id,
      project.name,
      project.color,
      project.keywords ? JSON.stringify(project.keywords) : null,
      project.folderPath || null,
      project.zoteroCollection || null,
      project.obsidianVault || null,
      project.createdAt,
      project.updatedAt
    ]
  );
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM projects WHERE id = ?', [id]);
  await db.execute('DELETE FROM project_todos WHERE project_id = ?', [id]);
  // Conversations are kept but orphaned (project_id becomes null in memory)
  await db.execute("UPDATE conversations SET project_id = NULL WHERE project_id = ?", [id]);
}

/* ───────────────────────────────────────────────
   Project Todo CRUD
   ─────────────────────────────────────────────── */

export async function loadTodos(projectId: string): Promise<ProjectTodo[]> {
  const db = await getDb();
  const rows = await db.select<
    { id: number; project_id: string; content: string; priority: string; status: string; created_at: number; completed_at: number | null }[]
  >(
    'SELECT * FROM project_todos WHERE project_id = ? ORDER BY created_at DESC',
    [projectId]
  );

  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    content: r.content,
    priority: r.priority as 'low' | 'medium' | 'high',
    status: r.status as 'pending' | 'completed',
    createdAt: r.created_at,
    completedAt: r.completed_at || undefined
  }));
}

export async function saveTodo(todo: ProjectTodo): Promise<void> {
  const db = await getDb();
  if (todo.id) {
    await db.execute(
      `UPDATE project_todos
       SET content = ?, priority = ?, status = ?, completed_at = ?
       WHERE id = ?`,
      [todo.content, todo.priority, todo.status, todo.completedAt || null, todo.id]
    );
  } else {
    await db.execute(
      `INSERT INTO project_todos (project_id, content, priority, status, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [todo.projectId, todo.content, todo.priority, todo.status, todo.createdAt, todo.completedAt || null]
    );
  }
}

export async function deleteTodo(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM project_todos WHERE id = ?', [id]);
}

/* ───────────────────────────────────────────────
   Conversation CRUD
   ─────────────────────────────────────────────── */

export async function loadConversations(projectId?: string | null): Promise<Conversation[]> {
  const db = await getDb();
  let query = 'SELECT * FROM conversations';
  const params: (string | null)[] = [];

  if (projectId !== undefined) {
    if (projectId === null) {
      query += ' WHERE project_id IS NULL';
    } else {
      query += ' WHERE project_id = ?';
      params.push(projectId);
    }
  }
  query += ' ORDER BY updated_at DESC';

  const rows = await db.select<
    { id: string; title: string; project_id: string | null; created_at: number; updated_at: number }[]
  >(query, params);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    projectId: r.project_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messages: [] // loaded separately
  }));
}

export async function saveConversation(conv: Conversation): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO conversations (id, title, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [conv.id, conv.title, conv.projectId || null, conv.createdAt, conv.updatedAt]
  );
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM conversations WHERE id = ?', [id]);
  await db.execute('DELETE FROM messages WHERE conversation_id = ?', [id]);
}

export async function updateConversationSummary(id: string, summary: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    'UPDATE conversations SET summary = ? WHERE id = ?',
    [summary, id]
  );
}

export async function loadRecentConversationSummaries(
  projectId: string | null,
  limit: number = 5
): Promise<{ id: string; title: string; summary: string | null }[]> {
  const db = await getDb();
  const rows = await db.select<
    { id: string; title: string; summary: string | null }[]
  >(
    `SELECT id, title, summary FROM conversations
     WHERE project_id IS ? AND summary IS NOT NULL AND summary != ''
     ORDER BY updated_at DESC
     LIMIT ?`,
    [projectId, limit]
  );
  return rows;
}

/* ───────────────────────────────────────────────
   Message CRUD
   ─────────────────────────────────────────────── */

export async function loadMessages(conversationId: string): Promise<HistoryMessage[]> {
  const db = await getDb();
  const rows = await db.select<
    { role: string; content: string }[]
  >(
    'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [conversationId]
  );

  return rows.map((r) => ({
    role: r.role as 'user' | 'assistant' | 'system',
    content: r.content
  }));
}

export async function saveMessages(
  conversationId: string,
  messages: HistoryMessage[]
): Promise<void> {
  const db = await getDb();

  // Delete existing messages for this conversation and re-insert
  await db.execute('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);

  const now = Date.now();
  for (const msg of messages) {
    await db.execute(
      'INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)',
      [conversationId, msg.role, msg.content, now]
    );
  }
}

/* ───────────────────────────────────────────────
   Activity Events CRUD
   ─────────────────────────────────────────────── */

export async function createActivityEventsTable(): Promise<void> {
  const db = await getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      project_id TEXT,
      duration_ms INTEGER,
      resource_id TEXT,
      metadata TEXT
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_events_type ON activity_events(event_type)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_events_project ON activity_events(project_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_events_time ON activity_events(timestamp)`);
}

/* ───────────────────────────────────────────────
   Usage Records CRUD
   ─────────────────────────────────────────────── */

export interface UsageRecord {
  id?: number;
  timestamp: number;
  taskType: string;
  projectId?: string | null;
  modelName: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  success: boolean;
  isFallback: boolean;
  estimatedCost: number;
}

export async function saveUsageRecord(record: UsageRecord): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO usage_records
     (timestamp, task_type, project_id, model_name, input_tokens, output_tokens, latency_ms, success, is_fallback, estimated_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.timestamp,
      record.taskType,
      record.projectId || null,
      record.modelName,
      record.inputTokens || null,
      record.outputTokens || null,
      record.latencyMs || null,
      record.success ? 1 : 0,
      record.isFallback ? 1 : 0,
      record.estimatedCost
    ]
  );
}

export interface UsageStats {
  totalCalls: number;
  totalTokens: number;
  totalCost: number;
  avgLatencyMs: number;
  modelBreakdown: { modelName: string; calls: number; cost: number }[];
  taskBreakdown: { taskType: string; calls: number; cost: number }[];
}

export async function getUsageStats(since: number): Promise<UsageStats> {
  const db = await getDb();

  const totalRow = await db.select<
    { total_calls: number; total_tokens: number; total_cost: number; avg_latency: number }[]
  >(
    `SELECT
      COUNT(*) as total_calls,
      COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
      COALESCE(SUM(estimated_cost), 0) as total_cost,
      COALESCE(AVG(latency_ms), 0) as avg_latency
     FROM usage_records WHERE timestamp >= ?`,
    [since]
  );

  const modelRows = await db.select<
    { model_name: string; calls: number; cost: number }[]
  >(
    `SELECT model_name, COUNT(*) as calls, SUM(estimated_cost) as cost
     FROM usage_records WHERE timestamp >= ?
     GROUP BY model_name ORDER BY cost DESC`,
    [since]
  );

  const taskRows = await db.select<
    { task_type: string; calls: number; cost: number }[]
  >(
    `SELECT task_type, COUNT(*) as calls, SUM(estimated_cost) as cost
     FROM usage_records WHERE timestamp >= ?
     GROUP BY task_type ORDER BY calls DESC`,
    [since]
  );

  return {
    totalCalls: totalRow[0]?.total_calls || 0,
    totalTokens: totalRow[0]?.total_tokens || 0,
    totalCost: Math.round((totalRow[0]?.total_cost || 0) * 100) / 100,
    avgLatencyMs: Math.round(totalRow[0]?.avg_latency || 0),
    modelBreakdown: modelRows.map(r => ({ modelName: r.model_name, calls: r.calls, cost: Math.round(r.cost * 100) / 100 })),
    taskBreakdown: taskRows.map(r => ({ taskType: r.task_type, calls: r.calls, cost: Math.round(r.cost * 100) / 100 }))
  };
}

/* ───────────────────────────────────────────────
   Knowledge Base CRUD
   ─────────────────────────────────────────────── */

export interface KnowledgeDoc {
  id: string;
  projectId?: string | null;
  filePath: string;
  fileName: string;
  fileType?: string;
  totalPages?: number;
  indexStatus: 'pending' | 'indexing' | 'completed' | 'error';
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocChunk {
  id?: number;
  docId: string;
  content: string;
  pageNumber?: number;
  chunkIndex: number;
  embedding?: number[];
  createdAt: number;
}

export async function loadKnowledgeDocs(projectId?: string | null): Promise<KnowledgeDoc[]> {
  const db = await getDb();
  let query = 'SELECT * FROM knowledge_docs';
  const params: (string | null)[] = [];

  if (projectId !== undefined) {
    if (projectId === null) {
      query += ' WHERE project_id IS NULL';
    } else {
      query += ' WHERE project_id = ?';
      params.push(projectId);
    }
  }
  query += ' ORDER BY updated_at DESC';

  const rows = await db.select<
    { id: string; project_id: string | null; file_path: string; file_name: string; file_type: string | null; total_pages: number | null; index_status: string; error_message: string | null; created_at: number; updated_at: number }[]
  >(query, params);

  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    filePath: r.file_path,
    fileName: r.file_name,
    fileType: r.file_type || undefined,
    totalPages: r.total_pages || undefined,
    indexStatus: r.index_status as KnowledgeDoc['indexStatus'],
    errorMessage: r.error_message || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

export async function saveKnowledgeDoc(doc: KnowledgeDoc): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO knowledge_docs
     (id, project_id, file_path, file_name, file_type, total_pages, index_status, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      doc.id,
      doc.projectId || null,
      doc.filePath,
      doc.fileName,
      doc.fileType || null,
      doc.totalPages || null,
      doc.indexStatus,
      doc.errorMessage || null,
      doc.createdAt,
      doc.updatedAt
    ]
  );
}

export async function updateKnowledgeDocStatus(
  docId: string,
  status: KnowledgeDoc['indexStatus'],
  errorMessage?: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE knowledge_docs SET index_status = ?, error_message = ?, updated_at = ? WHERE id = ?`,
    [status, errorMessage || null, Date.now(), docId]
  );
}

export async function deleteKnowledgeDoc(docId: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM doc_chunks WHERE doc_id = ?', [docId]);
  await db.execute('DELETE FROM knowledge_docs WHERE id = ?', [docId]);
}

export async function loadDocChunks(docId: string): Promise<DocChunk[]> {
  const db = await getDb();
  const rows = await db.select<
    { id: number; doc_id: string; content: string; page_number: number | null; chunk_index: number; embedding: string | null; created_at: number }[]
  >(
    'SELECT * FROM doc_chunks WHERE doc_id = ? ORDER BY chunk_index ASC',
    [docId]
  );

  return rows.map((r) => ({
    id: r.id,
    docId: r.doc_id,
    content: r.content,
    pageNumber: r.page_number || undefined,
    chunkIndex: r.chunk_index,
    embedding: r.embedding ? decodeEmbedding(r.embedding) : undefined,
    createdAt: r.created_at
  }));
}

export async function loadProjectChunks(projectId: string | null): Promise<DocChunk[]> {
  const db = await getDb();
  const query = projectId === null
    ? `SELECT c.* FROM doc_chunks c
       JOIN knowledge_docs d ON c.doc_id = d.id
       WHERE d.project_id IS NULL
       ORDER BY c.doc_id, c.chunk_index`
    : `SELECT c.* FROM doc_chunks c
       JOIN knowledge_docs d ON c.doc_id = d.id
       WHERE d.project_id = ?
       ORDER BY c.doc_id, c.chunk_index`;
  const params = projectId === null ? [] : [projectId];

  const rows = await db.select<
    { id: number; doc_id: string; content: string; page_number: number | null; chunk_index: number; embedding: string | null; created_at: number }[]
  >(query, params);

  return rows.map((r) => ({
    id: r.id,
    docId: r.doc_id,
    content: r.content,
    pageNumber: r.page_number || undefined,
    chunkIndex: r.chunk_index,
    embedding: r.embedding ? decodeEmbedding(r.embedding) : undefined,
    createdAt: r.created_at
  }));
}

export async function saveDocChunk(chunk: DocChunk): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO doc_chunks (doc_id, content, page_number, chunk_index, embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      chunk.docId,
      chunk.content,
      chunk.pageNumber || null,
      chunk.chunkIndex,
      chunk.embedding ? encodeEmbedding(chunk.embedding) : null,
      chunk.createdAt
    ]
  );
  return Number(result.lastInsertId);
}

export async function deleteDocChunks(docId: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM doc_chunks WHERE doc_id = ?', [docId]);
}

/** Encode a float vector to base64 string for SQLite storage. */
function encodeEmbedding(vec: number[]): string {
  const buffer = new Float32Array(vec).buffer;
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decode a base64 string back to a float vector. */
function decodeEmbedding(b64: string): number[] {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const floats = new Float32Array(bytes.buffer);
  return Array.from(floats);
}

/* ───────────────────────────────────────────────
   Zotero Cache CRUD
   ─────────────────────────────────────────────── */

export interface ZoteroItem {
  id: number;
  key: string;
  itemType: string;
  title?: string;
  creators?: string;
  abstract?: string;
  url?: string;
  doi?: string;
  date?: string;
  publication?: string;
  tags?: string;
  collections?: string;
  jsonData: string;
  version: number;
  syncedAt: number;
}

export interface ZoteroCollection {
  id: number;
  key: string;
  name: string;
  parentKey?: string;
  version: number;
  syncedAt: number;
}

export async function saveZoteroItems(items: ZoteroItem[]): Promise<void> {
  console.log('[DB] saveZoteroItems called with', items.length, 'items. Keys:', items.map((i) => i.key));
  const db = await getDb();
  for (const item of items) {
    await db.execute(
      `INSERT OR REPLACE INTO zotero_items_cache
       (id, key, item_type, title, creators, abstract, url, doi, date, publication, tags, collections, json_data, version, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        null, // id is auto-assigned by SQLite; passing 0 causes PRIMARY KEY collision on INSERT OR REPLACE
        item.key,
        item.itemType,
        item.title || null,
        item.creators || null,
        item.abstract || null,
        item.url || null,
        item.doi || null,
        item.date || null,
        item.publication || null,
        item.tags || null,
        item.collections || null,
        item.jsonData,
        item.version,
        item.syncedAt
      ]
    );
  }
}

export async function searchZoteroItems(query: string, limit: number = 20): Promise<ZoteroItem[]> {
  console.log('[DB] searchZoteroItems query="', query, '" limit=', limit);
  const db = await getDb();
  // Empty query: return all items without LIKE filtering (NULL values break LIKE '%%')
  if (!query.trim()) {
    const rows = await db.select<
      { id: number; key: string; item_type: string; title: string | null; creators: string | null; abstract: string | null; url: string | null; doi: string | null; date: string | null; publication: string | null; tags: string | null; collections: string | null; json_data: string; version: number; synced_at: number }[]
    >(
      `SELECT * FROM zotero_items_cache ORDER BY synced_at DESC LIMIT ?`,
      [limit]
    );
    const results = rows.map((r) => ({
      id: r.id,
      key: r.key,
      itemType: r.item_type,
      title: r.title || undefined,
      creators: r.creators || undefined,
      abstract: r.abstract || undefined,
      url: r.url || undefined,
      doi: r.doi || undefined,
      date: r.date || undefined,
      publication: r.publication || undefined,
      tags: r.tags || undefined,
      collections: r.collections || undefined,
      jsonData: r.json_data,
      version: r.version,
      syncedAt: r.synced_at
    }));
    console.log('[DB] searchZoteroItems (empty query) returned', results.length, 'results. Keys:', results.map((i) => i.key));
    return results;
  }

  const like = `%${query}%`;
  const rows = await db.select<
    { id: number; key: string; item_type: string; title: string | null; creators: string | null; abstract: string | null; url: string | null; doi: string | null; date: string | null; publication: string | null; tags: string | null; collections: string | null; json_data: string; version: number; synced_at: number }[]
  >(
    `SELECT * FROM zotero_items_cache
     WHERE COALESCE(title, '') LIKE ?
        OR COALESCE(creators, '') LIKE ?
        OR COALESCE(abstract, '') LIKE ?
        OR COALESCE(tags, '') LIKE ?
        OR COALESCE(publication, '') LIKE ?
     ORDER BY synced_at DESC
     LIMIT ?`,
    [like, like, like, like, like, limit]
  );
  const results = rows.map((r) => ({
    id: r.id,
    key: r.key,
    itemType: r.item_type,
    title: r.title || undefined,
    creators: r.creators || undefined,
    abstract: r.abstract || undefined,
    url: r.url || undefined,
    doi: r.doi || undefined,
    date: r.date || undefined,
    publication: r.publication || undefined,
    tags: r.tags || undefined,
    collections: r.collections || undefined,
    jsonData: r.json_data,
    version: r.version,
    syncedAt: r.synced_at
  }));
  console.log('[DB] searchZoteroItems returned', results.length, 'results. Keys:', results.map((i) => i.key));
  return results;
}

export async function loadZoteroItems(limit: number = 100): Promise<ZoteroItem[]> {
  const db = await getDb();
  const rows = await db.select<
    { id: number; key: string; item_type: string; title: string | null; creators: string | null; abstract: string | null; url: string | null; doi: string | null; date: string | null; publication: string | null; tags: string | null; collections: string | null; json_data: string; version: number; synced_at: number }[]
  >(
    'SELECT * FROM zotero_items_cache ORDER BY synced_at DESC LIMIT ?',
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    itemType: r.item_type,
    title: r.title || undefined,
    creators: r.creators || undefined,
    abstract: r.abstract || undefined,
    url: r.url || undefined,
    doi: r.doi || undefined,
    date: r.date || undefined,
    publication: r.publication || undefined,
    tags: r.tags || undefined,
    collections: r.collections || undefined,
    jsonData: r.json_data,
    version: r.version,
    syncedAt: r.synced_at
  }));
}

export async function getLastZoteroSyncTime(): Promise<number | null> {
  const db = await getDb();
  const rows = await db.select<[{ max_synced: number | null }]>(
    'SELECT MAX(synced_at) as max_synced FROM zotero_items_cache'
  );
  return rows[0]?.max_synced || null;
}

export async function clearZoteroCache(): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM zotero_items_cache');
  await db.execute('DELETE FROM zotero_collections_cache');
}

/* ───────────────────────────────────────────────
   Project Statistics
   ─────────────────────────────────────────────── */

export interface ProjectStats {
  docCount: number;
  conversationCount: number;
  todoCount: number;
}

export async function getProjectStats(projectId: string | null): Promise<ProjectStats> {
  const db = await getDb();

  const docRow = await db.select<[{ count: number }]>(
    'SELECT COUNT(*) as count FROM knowledge_docs WHERE project_id IS ?',
    [projectId]
  );

  const convRow = await db.select<[{ count: number }]>(
    'SELECT COUNT(*) as count FROM conversations WHERE project_id IS ?',
    [projectId]
  );

  const todoRow = await db.select<[{ count: number }]>(
    "SELECT COUNT(*) as count FROM project_todos WHERE project_id IS ? AND status = 'pending'",
    [projectId]
  );

  return {
    docCount: docRow[0]?.count || 0,
    conversationCount: convRow[0]?.count || 0,
    todoCount: todoRow[0]?.count || 0
  };
}

export async function saveZoteroCollections(collections: ZoteroCollection[]): Promise<void> {
  const db = await getDb();
  for (const coll of collections) {
    await db.execute(
      `INSERT OR REPLACE INTO zotero_collections_cache
       (id, key, name, parent_key, version, synced_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [coll.id, coll.key, coll.name, coll.parentKey || null, coll.version, coll.syncedAt]
    );
  }
}

export async function loadZoteroCollections(): Promise<ZoteroCollection[]> {
  const db = await getDb();
  const rows = await db.select<
    { id: number; key: string; name: string; parent_key: string | null; version: number; synced_at: number }[]
  >('SELECT * FROM zotero_collections_cache ORDER BY name');
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    parentKey: r.parent_key || undefined,
    version: r.version,
    syncedAt: r.synced_at
  }));
}

/* ───────────────────────────────────────────────
   Reset: clear all persisted data
   ─────────────────────────────────────────────── */

export async function resetAllData(): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM doc_chunks');
  await db.execute('DELETE FROM knowledge_docs');
  await db.execute('DELETE FROM messages');
  await db.execute('DELETE FROM conversations');
  await db.execute('DELETE FROM project_todos');
  await db.execute('DELETE FROM projects');
  await db.execute('DELETE FROM settings');
  await db.execute('DELETE FROM activity_events');
  await db.execute('DELETE FROM usage_records');
  await db.execute('DELETE FROM zotero_items_cache');
  await db.execute('DELETE FROM zotero_collections_cache');
}

/* ───────────────────────────────────────────────
   Migration: import legacy localStorage data
   ─────────────────────────────────────────────── */

export async function migrateFromLocalStorage(): Promise<void> {
  // Migrate settings
  try {
    const settingsRaw = localStorage.getItem('ai_assistant_settings');
    if (settingsRaw) {
      const existing = await loadSettings();
      if (!existing) {
        const parsed = JSON.parse(settingsRaw);
        await saveSettings(parsed);
        console.log('[DB Migration] Settings migrated from localStorage');
      }
    }
  } catch (e) {
    console.warn('[DB Migration] Failed to migrate settings:', e);
  }

  // Migrate conversations
  try {
    const historyRaw = localStorage.getItem('conversations');
    if (historyRaw) {
      const parsed = JSON.parse(historyRaw) as Conversation[];
      const existingConvs = await loadConversations();

      if (existingConvs.length === 0 && parsed.length > 0) {
        for (const conv of parsed) {
          await saveConversation(conv);
          await saveMessages(conv.id, conv.messages);
        }
        console.log('[DB Migration] Conversations migrated from localStorage');
      }
    }
  } catch (e) {
    console.warn('[DB Migration] Failed to migrate conversations:', e);
  }
}
