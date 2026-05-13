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

  // Migrate: add citation_style column for per-project citation preference (Phase 3)
  try {
    await db.execute(`ALTER TABLE projects ADD COLUMN citation_style TEXT`);
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
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_records(project_id)`);

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

  // Reading sessions: track PDF reading progress
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id      TEXT,
      document_title  TEXT NOT NULL,
      document_path   TEXT,
      start_page      INTEGER,
      end_page        INTEGER,
      pages_read      TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      started_at      INTEGER NOT NULL,
      ended_at        INTEGER,
      is_active       INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_reading_project ON reading_sessions(project_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_reading_active ON reading_sessions(is_active)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_reading_doc ON reading_sessions(document_title)`);

  // Reading notes: extracted content (formulas, tables, etc.) tied to sessions
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reading_notes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      INTEGER,
      document_title  TEXT NOT NULL,
      page_number     INTEGER,
      content_type    TEXT NOT NULL DEFAULT 'text',
      content         TEXT NOT NULL,
      source          TEXT,
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES reading_sessions(id) ON DELETE SET NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_reading_notes_session ON reading_notes(session_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_reading_notes_doc ON reading_notes(document_title)`);

  // Sentinel topics: literature monitoring topics per project
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sentinel_topics (
      id          TEXT PRIMARY KEY,
      project_id  TEXT,
      name        TEXT NOT NULL,
      keywords    TEXT NOT NULL,
      sources     TEXT NOT NULL DEFAULT 'arxiv,semantic_scholar',
      frequency   TEXT NOT NULL DEFAULT '6h',
      is_active   INTEGER NOT NULL DEFAULT 1,
      last_check_at INTEGER,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sentinel_project ON sentinel_topics(project_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sentinel_active ON sentinel_topics(is_active)`);

  // Sentinel papers: newly discovered papers from monitoring
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sentinel_papers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id        TEXT NOT NULL,
      title           TEXT NOT NULL,
      authors         TEXT,
      abstract        TEXT,
      url             TEXT,
      pdf_url         TEXT,
      doi             TEXT,
      published_date  TEXT,
      source          TEXT NOT NULL,
      similarity_score REAL,
      is_read         INTEGER DEFAULT 0,
      is_ignored      INTEGER DEFAULT 0,
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (topic_id) REFERENCES sentinel_topics(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sentinel_papers_topic ON sentinel_papers(topic_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sentinel_papers_read ON sentinel_papers(is_read)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sentinel_papers_created ON sentinel_papers(created_at)`);

  // Sentinel checks: check history log
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sentinel_checks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp       INTEGER NOT NULL,
      topics_checked  INTEGER,
      papers_found    INTEGER,
      duration_ms     INTEGER,
      metadata        TEXT
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sentinel_checks_time ON sentinel_checks(timestamp)`);

  // Experiment snapshots: structured experiment records
  await db.execute(`
    CREATE TABLE IF NOT EXISTS experiment_snapshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id      TEXT,
      timestamp       INTEGER NOT NULL,
      title           TEXT NOT NULL,
      type            TEXT NOT NULL,
      parameters      TEXT,
      notes           TEXT,
      screenshot_path TEXT,
      audio_path      TEXT,
      tags            TEXT,
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_experiment_project ON experiment_snapshots(project_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_experiment_type ON experiment_snapshots(type)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_experiment_time ON experiment_snapshots(timestamp)`);

  // Plugins: installed plugin registry
  await db.execute(`
    CREATE TABLE IF NOT EXISTS plugins (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      version     TEXT NOT NULL,
      author      TEXT,
      description TEXT,
      permissions TEXT NOT NULL DEFAULT '[]',
      enabled     INTEGER NOT NULL DEFAULT 1,
      manifest    TEXT NOT NULL,
      source_url  TEXT,
      install_path TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_plugins_enabled ON plugins(enabled)`);

  // Plugin settings: per-plugin configuration key-value store
  await db.execute(`
    CREATE TABLE IF NOT EXISTS plugin_settings (
      plugin_id   TEXT NOT NULL,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, key),
      FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
    )
  `);

  // Teams: collaboration spaces
  await db.execute(`
    CREATE TABLE IF NOT EXISTS teams (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      sync_mode   TEXT NOT NULL DEFAULT 'p2p',
      encryption_key TEXT,
      owner_id    TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);

  // Team members: membership and roles
  await db.execute(`
    CREATE TABLE IF NOT EXISTS team_members (
      team_id     TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      user_name   TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'member',
      joined_at   INTEGER NOT NULL,
      last_seen_at INTEGER,
      PRIMARY KEY (team_id, user_id),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )
  `);

  // Team activities: shared activity feed
  await db.execute(`
    CREATE TABLE IF NOT EXISTS team_activities (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id     TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      user_name   TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      title       TEXT NOT NULL,
      content     TEXT,
      metadata    TEXT,
      created_at  INTEGER NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_team_activities_team ON team_activities(team_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_team_activities_time ON team_activities(created_at)`);

  // Team invites: pending invitations
  await db.execute(`
    CREATE TABLE IF NOT EXISTS team_invites (
      id          TEXT PRIMARY KEY,
      team_id     TEXT NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      role        TEXT NOT NULL DEFAULT 'member',
      expires_at  INTEGER NOT NULL,
      created_at  INTEGER NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_team_invites_code ON team_invites(invite_code)`);

  // Hot list cache: persistent cache for Zhihu hot list API (100 req/day limit)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS hot_list_cache (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      items_json  TEXT NOT NULL,
      cached_at   INTEGER NOT NULL,
      is_mock     INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Hot topic materials: user-curated hot list items with AI-generated angles
  await db.execute(`
    CREATE TABLE IF NOT EXISTS hot_topic_materials (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      url         TEXT,
      thumbnail   TEXT,
      summary     TEXT,
      angles_json TEXT,
      created_at  INTEGER NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_htm_created ON hot_topic_materials(created_at)`);

  // Story library cache: persistent cache for Zhihu story library API (1 hour TTL)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS story_library_cache (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      items_json  TEXT NOT NULL,
      cached_at   INTEGER NOT NULL
    )
  `);

  // Story materials: user-curated story items with AI-generated angles
  await db.execute(`
    CREATE TABLE IF NOT EXISTS story_materials (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      url         TEXT,
      thumbnail   TEXT,
      summary     TEXT,
      angles_json TEXT,
      created_at  INTEGER NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sm_created ON story_materials(created_at)`);
}

/* ───────────────────────────────────────────────
   Hot List Cache
   ─────────────────────────────────────────────── */

export interface HotListCacheEntry {
  items: Array<{
    id: string;
    title: string;
    heat: string;
    url?: string;
    excerpt?: string;
    thumbnail?: string;
  }>;
  cachedAt: number;
  isMock: boolean;
}

export async function loadHotListCache(): Promise<HotListCacheEntry | null> {
  const db = await getDb();
  const rows = await db.select<
    { items_json: string; cached_at: number; is_mock: number }[]
  >('SELECT items_json, cached_at, is_mock FROM hot_list_cache WHERE id = 1');
  if (!rows.length) return null;
  try {
    return {
      items: JSON.parse(rows[0].items_json),
      cachedAt: rows[0].cached_at,
      isMock: rows[0].is_mock === 1,
    };
  } catch {
    return null;
  }
}

export async function saveHotListCache(entry: HotListCacheEntry): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO hot_list_cache (id, items_json, cached_at, is_mock) VALUES (1, ?, ?, ?)`,
    [JSON.stringify(entry.items), entry.cachedAt, entry.isMock ? 1 : 0]
  );
}

/* ───────────────────────────────────────────────
   Story Library Cache
   ─────────────────────────────────────────────── */

export interface StoryLibraryCacheEntry {
  items: Array<{
    work_id: string;
    title: string;
    artwork: string;
    tab_artwork: string;
    description: string;
    labels?: string[];
  }>;
  cachedAt: number;
}

export async function loadStoryLibraryCache(): Promise<StoryLibraryCacheEntry | null> {
  const db = await getDb();
  const rows = await db.select<
    { items_json: string; cached_at: number }[]
  >('SELECT items_json, cached_at FROM story_library_cache WHERE id = 1');
  if (!rows.length) return null;
  try {
    return {
      items: JSON.parse(rows[0].items_json),
      cachedAt: rows[0].cached_at,
    };
  } catch {
    return null;
  }
}

export async function saveStoryLibraryCache(entry: StoryLibraryCacheEntry): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO story_library_cache (id, items_json, cached_at) VALUES (1, ?, ?)`,
    [JSON.stringify(entry.items), entry.cachedAt]
  );
}

/* ───────────────────────────────────────────────
   Hot Topic Materials CRUD
   ─────────────────────────────────────────────── */

export interface HotTopicMaterial {
  id: number;
  title: string;
  url?: string;
  thumbnail?: string;
  summary?: string;
  angles?: string[];
  createdAt: number;
}

export async function loadHotTopicMaterials(): Promise<HotTopicMaterial[]> {
  const db = await getDb();
  const rows = await db.select<
    { id: number; title: string; url: string | null; thumbnail: string | null; summary: string | null; angles_json: string | null; created_at: number }[]
  >('SELECT * FROM hot_topic_materials ORDER BY created_at DESC');

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url ?? undefined,
    thumbnail: r.thumbnail ?? undefined,
    summary: r.summary ?? undefined,
    angles: r.angles_json ? JSON.parse(r.angles_json) : undefined,
    createdAt: r.created_at,
  }));
}

export async function addHotTopicMaterial(
  material: Omit<HotTopicMaterial, 'id' | 'createdAt'>
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO hot_topic_materials (title, url, thumbnail, summary, angles_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      material.title,
      material.url ?? null,
      material.thumbnail ?? null,
      material.summary ?? null,
      material.angles ? JSON.stringify(material.angles) : null,
      Date.now(),
    ]
  );
  return Number(result.lastInsertId);
}

export async function deleteHotTopicMaterial(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM hot_topic_materials WHERE id = ?', [id]);
}

/* ───────────────────────────────────────────────
   Story Materials CRUD
   ─────────────────────────────────────────────── */

export interface StoryMaterial {
  id: number;
  title: string;
  url?: string;
  thumbnail?: string;
  summary?: string;
  angles?: string[];
  createdAt: number;
}

export async function loadStoryMaterials(): Promise<StoryMaterial[]> {
  const db = await getDb();
  const rows = await db.select<
    { id: number; title: string; url: string | null; thumbnail: string | null; summary: string | null; angles_json: string | null; created_at: number }[]
  >('SELECT * FROM story_materials ORDER BY created_at DESC');

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url ?? undefined,
    thumbnail: r.thumbnail ?? undefined,
    summary: r.summary ?? undefined,
    angles: r.angles_json ? JSON.parse(r.angles_json) : undefined,
    createdAt: r.created_at,
  }));
}

export async function addStoryMaterial(
  material: Omit<StoryMaterial, 'id' | 'createdAt'>
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO story_materials (title, url, thumbnail, summary, angles_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      material.title,
      material.url ?? null,
      material.thumbnail ?? null,
      material.summary ?? null,
      material.angles ? JSON.stringify(material.angles) : null,
      Date.now(),
    ]
  );
  return Number(result.lastInsertId);
}

export async function deleteStoryMaterial(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM story_materials WHERE id = ?', [id]);
}

export async function clearHotTopicMaterials(): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM hot_topic_materials');
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
    { id: string; name: string; color: string; keywords: string | null; folder_path: string | null; obsidian_vault: string | null; citation_style: string | null; created_at: number; updated_at: number }[]
  >('SELECT * FROM projects ORDER BY updated_at DESC');

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    keywords: r.keywords ? JSON.parse(r.keywords) : [],
    folderPath: r.folder_path ?? undefined,
    obsidianVault: r.obsidian_vault ?? undefined,
    citationStyle: (r.citation_style as Project['citationStyle']) ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

export async function saveProject(project: Project): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO projects
     (id, name, color, keywords, folder_path, obsidian_vault, citation_style, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      project.id,
      project.name,
      project.color,
      project.keywords ? JSON.stringify(project.keywords) : null,
      project.folderPath || null,
      project.obsidianVault || null,
      project.citationStyle || null,
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

/** Load recent messages across all conversations for context analysis. */
export async function loadRecentMessages(limit: number = 50): Promise<HistoryMessage[]> {
  const db = await getDb();
  const rows = await db.select<
    { role: string; content: string }[]
  >(
    'SELECT role, content FROM messages ORDER BY created_at DESC LIMIT ?',
    [limit]
  );

  return rows.reverse().map((r) => ({
    role: r.role as 'user' | 'assistant' | 'system',
    content: r.content
  }));
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

export interface EventStats {
  totalEvents: number;
  typeBreakdown: { eventType: string; count: number }[];
  projectBreakdown: { projectId: string | null; count: number }[];
}

export async function getEventStats(since: number, projectId?: string | null): Promise<EventStats> {
  const db = await getDb();

  const projectFilter = projectId !== undefined && projectId !== null
    ? 'AND project_id = ?'
    : '';
  const params = projectId !== undefined && projectId !== null ? [since, projectId] : [since];

  const totalRow = await db.select<[{ count: number }]>(
    `SELECT COUNT(*) as count FROM activity_events WHERE timestamp >= ? ${projectFilter}`,
    params
  );

  const typeRows = await db.select<
    { event_type: string; count: number }[]
  >(
    `SELECT event_type, COUNT(*) as count
     FROM activity_events WHERE timestamp >= ? ${projectFilter}
     GROUP BY event_type ORDER BY count DESC`,
    params
  );

  const projectRows = await db.select<
    { project_id: string | null; count: number }[]
  >(
    `SELECT project_id, COUNT(*) as count
     FROM activity_events WHERE timestamp >= ? ${projectFilter}
     GROUP BY project_id ORDER BY count DESC`,
    params
  );

  return {
    totalEvents: totalRow[0]?.count || 0,
    typeBreakdown: typeRows.map((r) => ({ eventType: r.event_type, count: r.count })),
    projectBreakdown: projectRows.map((r) => ({ projectId: r.project_id, count: r.count }))
  };
}

export interface DailyEventCount {
  date: string; // YYYY-MM-DD
  count: number;
}

export async function getDailyEventCounts(
  eventType: string | null,
  days: number,
  projectId?: string | null
): Promise<DailyEventCount[]> {
  const db = await getDb();
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  let query: string;
  let params: (string | number)[];

  const projectFilter = projectId !== undefined && projectId !== null
    ? 'AND project_id = ?'
    : '';

  if (eventType) {
    query = `
      SELECT date(timestamp/1000, 'unixepoch', 'localtime') as day, COUNT(*) as count
      FROM activity_events
      WHERE event_type = ? AND timestamp >= ? ${projectFilter}
      GROUP BY day ORDER BY day ASC
    `;
    params = projectId !== undefined && projectId !== null
      ? [eventType, since, projectId]
      : [eventType, since];
  } else {
    query = `
      SELECT date(timestamp/1000, 'unixepoch', 'localtime') as day, COUNT(*) as count
      FROM activity_events
      WHERE timestamp >= ? ${projectFilter}
      GROUP BY day ORDER BY day ASC
    `;
    params = projectId !== undefined && projectId !== null
      ? [since, projectId]
      : [since];
  }

  const rows = await db.select<{ day: string; count: number }[]>(query, params);

  // Fill in missing days with 0
  const result: DailyEventCount[] = [];
  const rowMap = new Map(rows.map((r) => [r.day, r.count]));
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    result.push({ date: dateStr, count: rowMap.get(dateStr) || 0 });
  }

  return result;
}

export async function getEventsByProject(
  projectId: string | null,
  since: number,
  limit: number = 100
): Promise<WritingEvent[]> {
  const db = await getDb();

  let query = `
    SELECT id, event_type, timestamp, project_id, duration_ms, resource_id, metadata
    FROM activity_events
    WHERE timestamp >= ?
  `;
  const params: (string | number | null)[] = [since];

  if (projectId !== undefined) {
    if (projectId === null) {
      query += ' AND project_id IS NULL';
    } else {
      query += ' AND project_id = ?';
      params.push(projectId);
    }
  }

  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const rows = await db.select<
    Array<{
      id: number;
      event_type: string;
      timestamp: number;
      project_id: string | null;
      duration_ms: number | null;
      resource_id: string | null;
      metadata: string | null;
    }>
  >(query, params);

  return rows.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    timestamp: r.timestamp,
    projectId: r.project_id,
    durationMs: r.duration_ms,
    resourceId: r.resource_id,
    metadata: r.metadata ? JSON.parse(r.metadata) : null
  }));
}

export async function getRecentEvents(limit: number = 50): Promise<WritingEvent[]> {
  const db = await getDb();

  const rows = await db.select<
    Array<{
      id: number;
      event_type: string;
      timestamp: number;
      project_id: string | null;
      duration_ms: number | null;
      resource_id: string | null;
      metadata: string | null;
    }>
  >(
    `SELECT id, event_type, timestamp, project_id, duration_ms, resource_id, metadata
     FROM activity_events
     ORDER BY timestamp DESC LIMIT ?`,
    [limit]
  );

  return rows.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    timestamp: r.timestamp,
    projectId: r.project_id,
    durationMs: r.duration_ms,
    resourceId: r.resource_id,
    metadata: r.metadata ? JSON.parse(r.metadata) : null
  }));
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

export async function getUsageStats(since: number, projectId?: string | null): Promise<UsageStats> {
  const db = await getDb();

  const projectFilter = projectId !== undefined && projectId !== null
    ? 'AND project_id = ?'
    : '';
  const params = projectId !== undefined && projectId !== null ? [since, projectId] : [since];

  const totalRow = await db.select<
    { total_calls: number; total_tokens: number; total_cost: number; avg_latency: number }[]
  >(
    `SELECT
      COUNT(*) as total_calls,
      COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
      COALESCE(SUM(estimated_cost), 0) as total_cost,
      COALESCE(AVG(latency_ms), 0) as avg_latency
     FROM usage_records WHERE timestamp >= ? ${projectFilter}`,
    params
  );

  const modelRows = await db.select<
    { model_name: string; calls: number; cost: number }[]
  >(
    `SELECT model_name, COUNT(*) as calls, SUM(estimated_cost) as cost
     FROM usage_records WHERE timestamp >= ? ${projectFilter}
     GROUP BY model_name ORDER BY cost DESC`,
    params
  );

  const taskRows = await db.select<
    { task_type: string; calls: number; cost: number }[]
  >(
    `SELECT task_type, COUNT(*) as calls, SUM(estimated_cost) as cost
     FROM usage_records WHERE timestamp >= ? ${projectFilter}
     GROUP BY task_type ORDER BY calls DESC`,
    params
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

/* ───────────────────────────────────────────────
   Reading Session CRUD
   ─────────────────────────────────────────────── */

export interface ReadingSession {
  id?: number;
  projectId?: string | null;
  documentTitle: string;
  documentPath?: string;
  startPage?: number;
  endPage?: number;
  pagesRead: number[];
  durationSeconds: number;
  startedAt: number;
  endedAt?: number;
  isActive: boolean;
}

export async function createReadingSession(session: ReadingSession): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO reading_sessions
     (project_id, document_title, document_path, start_page, end_page, pages_read, duration_seconds, started_at, ended_at, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.projectId || null,
      session.documentTitle,
      session.documentPath || null,
      session.startPage || null,
      session.endPage || null,
      JSON.stringify(session.pagesRead),
      session.durationSeconds,
      session.startedAt,
      session.endedAt || null,
      session.isActive ? 1 : 0
    ]
  );
  return Number(result.lastInsertId);
}

export async function updateReadingSession(session: ReadingSession): Promise<void> {
  if (!session.id) return;
  const db = await getDb();
  await db.execute(
    `UPDATE reading_sessions SET
      project_id = ?, document_title = ?, document_path = ?,
      start_page = ?, end_page = ?, pages_read = ?,
      duration_seconds = ?, started_at = ?, ended_at = ?, is_active = ?
     WHERE id = ?`,
    [
      session.projectId || null,
      session.documentTitle,
      session.documentPath || null,
      session.startPage || null,
      session.endPage || null,
      JSON.stringify(session.pagesRead),
      session.durationSeconds,
      session.startedAt,
      session.endedAt || null,
      session.isActive ? 1 : 0,
      session.id
    ]
  );
}

export async function getActiveReadingSession(): Promise<ReadingSession | null> {
  const db = await getDb();
  const rows = await db.select<
    { id: number; project_id: string | null; document_title: string; document_path: string | null; start_page: number | null; end_page: number | null; pages_read: string; duration_seconds: number; started_at: number; ended_at: number | null; is_active: number }[]
  >('SELECT * FROM reading_sessions WHERE is_active = 1 ORDER BY started_at DESC LIMIT 1');

  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    projectId: r.project_id,
    documentTitle: r.document_title,
    documentPath: r.document_path || undefined,
    startPage: r.start_page || undefined,
    endPage: r.end_page || undefined,
    pagesRead: r.pages_read ? JSON.parse(r.pages_read) : [],
    durationSeconds: r.duration_seconds,
    startedAt: r.started_at,
    endedAt: r.ended_at || undefined,
    isActive: r.is_active === 1
  };
}

export async function getReadingSessions(projectId?: string | null, limit: number = 50): Promise<ReadingSession[]> {
  const db = await getDb();
  let query = 'SELECT * FROM reading_sessions';
  const params: (string | number | null)[] = [];

  if (projectId !== undefined) {
    query += ' WHERE project_id IS ?';
    params.push(projectId);
  }
  query += ' ORDER BY started_at DESC LIMIT ?';
  params.push(limit);

  const rows = await db.select<
    { id: number; project_id: string | null; document_title: string; document_path: string | null; start_page: number | null; end_page: number | null; pages_read: string; duration_seconds: number; started_at: number; ended_at: number | null; is_active: number }[]
  >(query, params);

  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    documentTitle: r.document_title,
    documentPath: r.document_path || undefined,
    startPage: r.start_page || undefined,
    endPage: r.end_page || undefined,
    pagesRead: r.pages_read ? JSON.parse(r.pages_read) : [],
    durationSeconds: r.duration_seconds,
    startedAt: r.started_at,
    endedAt: r.ended_at || undefined,
    isActive: r.is_active === 1
  }));
}

export async function getReadingStats(projectId?: string | null): Promise<{ totalSessions: number; totalDurationMinutes: number; totalPagesRead: number; documentsRead: number }> {
  const db = await getDb();
  let whereClause = '';
  const params: (string | null)[] = [];

  if (projectId !== undefined) {
    whereClause = 'WHERE project_id IS ?';
    params.push(projectId);
  }

  const sessionRow = await db.select<[{ count: number }]>(
    `SELECT COUNT(*) as count FROM reading_sessions ${whereClause}`,
    params
  );

  const durationRow = await db.select<[{ total: number }]>(
    `SELECT COALESCE(SUM(duration_seconds), 0) as total FROM reading_sessions ${whereClause}`,
    [...params]
  );

  const docRow = await db.select<[{ count: number }]>(
    `SELECT COUNT(DISTINCT document_title) as count FROM reading_sessions ${whereClause}`,
    [...params]
  );

  // Sum pages_read JSON arrays is complex in SQLite; approximate by counting sessions with pages
  const pagesRow = await db.select<[{ count: number }]>(
    `SELECT COUNT(*) as count FROM reading_sessions ${whereClause} AND pages_read IS NOT NULL AND pages_read != '[]'`,
    [...params]
  );

  return {
    totalSessions: sessionRow[0]?.count || 0,
    totalDurationMinutes: Math.round((durationRow[0]?.total || 0) / 60),
    totalPagesRead: pagesRow[0]?.count || 0,
    documentsRead: docRow[0]?.count || 0
  };
}

/* ───────────────────────────────────────────────
   Reading Note CRUD
   ─────────────────────────────────────────────── */

export interface ReadingNote {
  id?: number;
  sessionId?: number | null;
  documentTitle: string;
  pageNumber?: number;
  contentType: 'text' | 'formula' | 'table' | 'theorem';
  content: string;
  source?: string;
  createdAt?: number;
}

export async function createReadingNote(note: ReadingNote): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  const result = await db.execute(
    `INSERT INTO reading_notes (session_id, document_title, page_number, content_type, content, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      note.sessionId ?? null,
      note.documentTitle,
      note.pageNumber ?? null,
      note.contentType,
      note.content,
      note.source ?? null,
      now
    ]
  );
  return result.lastInsertId ?? 0;
}

export async function getReadingNotes(documentTitle?: string, limit: number = 50): Promise<ReadingNote[]> {
  const db = await getDb();
  let query = 'SELECT * FROM reading_notes';
  const params: (string | number | null)[] = [];

  if (documentTitle) {
    query += ' WHERE document_title = ?';
    params.push(documentTitle);
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const rows = await db.select<
    { id: number; session_id: number | null; document_title: string; page_number: number | null; content_type: string; content: string; source: string | null; created_at: number }[]
  >(query, params);

  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    documentTitle: r.document_title,
    pageNumber: r.page_number ?? undefined,
    contentType: r.content_type as ReadingNote['contentType'],
    content: r.content,
    source: r.source ?? undefined,
    createdAt: r.created_at
  }));
}

export async function deleteReadingNote(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM reading_notes WHERE id = ?', [id]);
}

export interface WritingEvent {
  id: number;
  eventType: string;
  timestamp: number;
  projectId: string | null;
  durationMs: number | null;
  resourceId: string | null;
  metadata: Record<string, any> | null;
}

export async function getWritingEvents(
  projectId: string | null,
  limit: number = 100
): Promise<WritingEvent[]> {
  const db = await getDb();
  const writingEventTypes = [
    'writing_polish',
    'citation_recommend',
    'citation_insert',
    'writing_format_fix',
    'note_save_to_obsidian'
  ];

  const placeholders = writingEventTypes.map(() => '?').join(',');
  let query = `
    SELECT id, event_type, timestamp, project_id, duration_ms, resource_id, metadata
    FROM activity_events
    WHERE event_type IN (${placeholders})
  `;
  const params: (string | number | null)[] = [...writingEventTypes];

  if (projectId) {
    query += ' AND project_id = ?';
    params.push(projectId);
  }

  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const rows = await db.select<
    Array<{
      id: number;
      event_type: string;
      timestamp: number;
      project_id: string | null;
      duration_ms: number | null;
      resource_id: string | null;
      metadata: string | null;
    }>
  >(query, params);

  return rows.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    timestamp: r.timestamp,
    projectId: r.project_id,
    durationMs: r.duration_ms,
    resourceId: r.resource_id,
    metadata: r.metadata ? JSON.parse(r.metadata) : null
  }));
}

/* ───────────────────────────────────────────────
   Sentinel (Literature Sentinel) CRUD
   ─────────────────────────────────────────────── */

export interface SentinelTopic {
  id?: string;
  projectId?: string | null;
  name: string;
  keywords: string[];
  sources: string;
  frequency: string;
  isActive: boolean;
  lastCheckAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface SentinelPaper {
  id?: number;
  topicId: string;
  title: string;
  authors?: string;
  abstract?: string;
  url?: string;
  pdfUrl?: string;
  doi?: string;
  publishedDate?: string;
  source: string;
  similarityScore?: number | null;
  isRead: boolean;
  isIgnored: boolean;
  createdAt?: number;
}

export interface SentinelCheck {
  id?: number;
  timestamp: number;
  topicsChecked?: number | null;
  papersFound?: number | null;
  durationMs?: number | null;
  metadata?: Record<string, any> | null;
}

export async function createSentinelTopic(topic: SentinelTopic): Promise<string> {
  const db = await getDb();
  const now = Date.now();
  const id = topic.id || `sentinel_${now}`;
  await db.execute(
    `INSERT INTO sentinel_topics (id, project_id, name, keywords, sources, frequency, is_active, last_check_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      topic.projectId ?? null,
      topic.name,
      JSON.stringify(topic.keywords),
      topic.sources,
      topic.frequency,
      topic.isActive ? 1 : 0,
      topic.lastCheckAt ?? null,
      now,
      now
    ]
  );
  return id;
}

export async function updateSentinelTopic(topic: SentinelTopic): Promise<void> {
  if (!topic.id) return;
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `UPDATE sentinel_topics
     SET name = ?, keywords = ?, sources = ?, frequency = ?, is_active = ?, last_check_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      topic.name,
      JSON.stringify(topic.keywords),
      topic.sources,
      topic.frequency,
      topic.isActive ? 1 : 0,
      topic.lastCheckAt ?? null,
      now,
      topic.id
    ]
  );
}

export async function deleteSentinelTopic(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM sentinel_topics WHERE id = ?', [id]);
}

export async function getSentinelTopics(projectId?: string | null): Promise<SentinelTopic[]> {
  const db = await getDb();
  let query = 'SELECT * FROM sentinel_topics';
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
    Array<{
      id: string;
      project_id: string | null;
      name: string;
      keywords: string;
      sources: string;
      frequency: string;
      is_active: number;
      last_check_at: number | null;
      created_at: number;
      updated_at: number;
    }>
  >(query, params);

  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    keywords: r.keywords ? JSON.parse(r.keywords) : [],
    sources: r.sources,
    frequency: r.frequency,
    isActive: r.is_active === 1,
    lastCheckAt: r.last_check_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

export async function createSentinelPaper(paper: SentinelPaper): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  const result = await db.execute(
    `INSERT INTO sentinel_papers (topic_id, title, authors, abstract, url, pdf_url, doi, published_date, source, similarity_score, is_read, is_ignored, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      paper.topicId,
      paper.title,
      paper.authors ?? null,
      paper.abstract ?? null,
      paper.url ?? null,
      paper.pdfUrl ?? null,
      paper.doi ?? null,
      paper.publishedDate ?? null,
      paper.source,
      paper.similarityScore ?? null,
      paper.isRead ? 1 : 0,
      paper.isIgnored ? 1 : 0,
      now
    ]
  );
  return result.lastInsertId ?? 0;
}

export async function getSentinelPapers(
  topicId?: string,
  isRead?: boolean,
  isIgnored?: boolean,
  limit: number = 100
): Promise<SentinelPaper[]> {
  const db = await getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (topicId) {
    conditions.push('topic_id = ?');
    params.push(topicId);
  }
  if (isRead !== undefined) {
    conditions.push('is_read = ?');
    params.push(isRead ? 1 : 0);
  }
  if (isIgnored !== undefined) {
    conditions.push('is_ignored = ?');
    params.push(isIgnored ? 1 : 0);
  }

  let query = 'SELECT * FROM sentinel_papers';
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const rows = await db.select<
    Array<{
      id: number;
      topic_id: string;
      title: string;
      authors: string | null;
      abstract: string | null;
      url: string | null;
      pdf_url: string | null;
      doi: string | null;
      published_date: string | null;
      source: string;
      similarity_score: number | null;
      is_read: number;
      is_ignored: number;
      created_at: number;
    }>
  >(query, params);

  return rows.map((r) => ({
    id: r.id,
    topicId: r.topic_id,
    title: r.title,
    authors: r.authors ?? undefined,
    abstract: r.abstract ?? undefined,
    url: r.url ?? undefined,
    pdfUrl: r.pdf_url ?? undefined,
    doi: r.doi ?? undefined,
    publishedDate: r.published_date ?? undefined,
    source: r.source,
    similarityScore: r.similarity_score,
    isRead: r.is_read === 1,
    isIgnored: r.is_ignored === 1,
    createdAt: r.created_at
  }));
}

export async function markSentinelPaper(
  id: number,
  updates: { isRead?: boolean; isIgnored?: boolean }
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const params: (number | number)[] = [];

  if (updates.isRead !== undefined) {
    sets.push('is_read = ?');
    params.push(updates.isRead ? 1 : 0);
  }
  if (updates.isIgnored !== undefined) {
    sets.push('is_ignored = ?');
    params.push(updates.isIgnored ? 1 : 0);
  }
  if (sets.length === 0) return;

  params.push(id);
  await db.execute(
    `UPDATE sentinel_papers SET ${sets.join(', ')} WHERE id = ?`,
    params
  );
}

export async function countUnreadSentinelPapers(projectId?: string | null): Promise<number> {
  const db = await getDb();
  let query = `
    SELECT COUNT(*) as count FROM sentinel_papers sp
    JOIN sentinel_topics st ON sp.topic_id = st.id
    WHERE sp.is_read = 0 AND sp.is_ignored = 0
  `;
  const params: (string | null)[] = [];

  if (projectId !== undefined) {
    if (projectId === null) {
      query += ' AND st.project_id IS NULL';
    } else {
      query += ' AND st.project_id = ?';
      params.push(projectId);
    }
  }

  const rows = await db.select<Array<{ count: number }>>(query, params);
  return rows[0]?.count ?? 0;
}

export async function createSentinelCheck(check: SentinelCheck): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO sentinel_checks (timestamp, topics_checked, papers_found, duration_ms, metadata)
     VALUES (?, ?, ?, ?, ?)`,
    [
      check.timestamp,
      check.topicsChecked ?? null,
      check.papersFound ?? null,
      check.durationMs ?? null,
      check.metadata ? JSON.stringify(check.metadata) : null
    ]
  );
  return result.lastInsertId ?? 0;
}

/* ───────────────────────────────────────────────
   Experiment Snapshot CRUD
   ─────────────────────────────────────────────── */

export interface ExperimentSnapshot {
  id?: number;
  projectId?: string | null;
  timestamp: number;
  title: string;
  type: 'screenshot' | 'terminal' | 'code' | 'voice';
  parameters?: Record<string, string> | null;
  notes?: string | null;
  screenshotPath?: string | null;
  audioPath?: string | null;
  tags?: string[] | null;
  createdAt?: number;
}

export async function createExperimentSnapshot(snapshot: ExperimentSnapshot): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  const result = await db.execute(
    `INSERT INTO experiment_snapshots
     (project_id, timestamp, title, type, parameters, notes, screenshot_path, audio_path, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshot.projectId ?? null,
      snapshot.timestamp,
      snapshot.title,
      snapshot.type,
      snapshot.parameters ? JSON.stringify(snapshot.parameters) : null,
      snapshot.notes ?? null,
      snapshot.screenshotPath ?? null,
      snapshot.audioPath ?? null,
      snapshot.tags ? JSON.stringify(snapshot.tags) : null,
      now
    ]
  );
  return result.lastInsertId ?? 0;
}

export async function getExperimentSnapshots(
  projectId?: string | null,
  limit: number = 100
): Promise<ExperimentSnapshot[]> {
  const db = await getDb();
  let query = 'SELECT * FROM experiment_snapshots';
  const params: (string | number | null)[] = [];

  if (projectId !== undefined) {
    if (projectId === null) {
      query += ' WHERE project_id IS NULL';
    } else {
      query += ' WHERE project_id = ?';
      params.push(projectId);
    }
  }
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const rows = await db.select<
    Array<{
      id: number;
      project_id: string | null;
      timestamp: number;
      title: string;
      type: string;
      parameters: string | null;
      notes: string | null;
      screenshot_path: string | null;
      audio_path: string | null;
      tags: string | null;
      created_at: number;
    }>
  >(query, params);

  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    timestamp: r.timestamp,
    title: r.title,
    type: r.type as ExperimentSnapshot['type'],
    parameters: r.parameters ? JSON.parse(r.parameters) : null,
    notes: r.notes ?? undefined,
    screenshotPath: r.screenshot_path ?? undefined,
    audioPath: r.audio_path ?? undefined,
    tags: r.tags ? JSON.parse(r.tags) : null,
    createdAt: r.created_at
  }));
}

export async function searchExperimentSnapshots(
  queryStr: string,
  projectId?: string | null,
  limit: number = 50
): Promise<ExperimentSnapshot[]> {
  const db = await getDb();
  const like = `%${queryStr}%`;
  let query = `
    SELECT * FROM experiment_snapshots
    WHERE (title LIKE ? OR notes LIKE ? OR parameters LIKE ? OR tags LIKE ?)
  `;
  const params: (string | number | null)[] = [like, like, like, like];

  if (projectId !== undefined) {
    if (projectId === null) {
      query += ' AND project_id IS NULL';
    } else {
      query += ' AND project_id = ?';
      params.push(projectId);
    }
  }
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const rows = await db.select<
    Array<{
      id: number;
      project_id: string | null;
      timestamp: number;
      title: string;
      type: string;
      parameters: string | null;
      notes: string | null;
      screenshot_path: string | null;
      audio_path: string | null;
      tags: string | null;
      created_at: number;
    }>
  >(query, params);

  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    timestamp: r.timestamp,
    title: r.title,
    type: r.type as ExperimentSnapshot['type'],
    parameters: r.parameters ? JSON.parse(r.parameters) : null,
    notes: r.notes ?? undefined,
    screenshotPath: r.screenshot_path ?? undefined,
    audioPath: r.audio_path ?? undefined,
    tags: r.tags ? JSON.parse(r.tags) : null,
    createdAt: r.created_at
  }));
}

export async function deleteExperimentSnapshot(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM experiment_snapshots WHERE id = ?', [id]);
}

/* ───────────────────────────────────────────────
   Plugin CRUD
   ─────────────────────────────────────────────── */

export interface PluginDef {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  permissions: string[];
  enabled: boolean;
  manifest: Record<string, any>;
  sourceUrl?: string;
  installPath?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PluginSetting {
  pluginId: string;
  key: string;
  value: string;
  updatedAt: number;
}

export async function savePlugin(plugin: PluginDef): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `INSERT OR REPLACE INTO plugins
     (id, name, version, author, description, permissions, enabled, manifest, source_url, install_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      plugin.id,
      plugin.name,
      plugin.version,
      plugin.author || null,
      plugin.description || null,
      JSON.stringify(plugin.permissions),
      plugin.enabled ? 1 : 0,
      JSON.stringify(plugin.manifest),
      plugin.sourceUrl || null,
      plugin.installPath || null,
      plugin.createdAt || now,
      now
    ]
  );
}

export async function getPlugins(enabledOnly?: boolean): Promise<PluginDef[]> {
  const db = await getDb();
  let query = 'SELECT * FROM plugins';
  const params: number[] = [];
  if (enabledOnly) {
    query += ' WHERE enabled = 1';
  }
  query += ' ORDER BY updated_at DESC';

  const rows = await db.select<
    Array<{
      id: string; name: string; version: string; author: string | null;
      description: string | null; permissions: string; enabled: number;
      manifest: string; source_url: string | null; install_path: string | null;
      created_at: number; updated_at: number;
    }>
  >(query, params);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    version: r.version,
    author: r.author ?? undefined,
    description: r.description ?? undefined,
    permissions: r.permissions ? JSON.parse(r.permissions) : [],
    enabled: r.enabled === 1,
    manifest: r.manifest ? JSON.parse(r.manifest) : {},
    sourceUrl: r.source_url ?? undefined,
    installPath: r.install_path ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

export async function getPlugin(id: string): Promise<PluginDef | null> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      id: string; name: string; version: string; author: string | null;
      description: string | null; permissions: string; enabled: number;
      manifest: string; source_url: string | null; install_path: string | null;
      created_at: number; updated_at: number;
    }>
  >('SELECT * FROM plugins WHERE id = ?', [id]);

  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    author: r.author ?? undefined,
    description: r.description ?? undefined,
    permissions: r.permissions ? JSON.parse(r.permissions) : [],
    enabled: r.enabled === 1,
    manifest: r.manifest ? JSON.parse(r.manifest) : {},
    sourceUrl: r.source_url ?? undefined,
    installPath: r.install_path ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export async function togglePlugin(id: string, enabled: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(
    'UPDATE plugins SET enabled = ?, updated_at = ? WHERE id = ?',
    [enabled ? 1 : 0, Date.now(), id]
  );
}

export async function deletePlugin(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM plugin_settings WHERE plugin_id = ?', [id]);
  await db.execute('DELETE FROM plugins WHERE id = ?', [id]);
}

export async function savePluginSetting(setting: PluginSetting): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO plugin_settings (plugin_id, key, value, updated_at)
     VALUES (?, ?, ?, ?)`,
    [setting.pluginId, setting.key, setting.value, Date.now()]
  );
}

export async function getPluginSettings(pluginId: string): Promise<PluginSetting[]> {
  const db = await getDb();
  const rows = await db.select<
    Array<{ plugin_id: string; key: string; value: string; updated_at: number }>
  >('SELECT * FROM plugin_settings WHERE plugin_id = ?', [pluginId]);

  return rows.map((r) => ({
    pluginId: r.plugin_id,
    key: r.key,
    value: r.value,
    updatedAt: r.updated_at
  }));
}

/* ───────────────────────────────────────────────
   Team CRUD
   ─────────────────────────────────────────────── */

export interface Team {
  id: string;
  name: string;
  syncMode: 'p2p' | 'server';
  encryptionKey?: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  userName: string;
  role: 'owner' | 'member' | 'viewer';
  joinedAt: number;
  lastSeenAt?: number;
}

export interface TeamActivity {
  id?: number;
  teamId: string;
  userId: string;
  userName: string;
  activityType: string;
  title: string;
  content?: string;
  metadata?: Record<string, any>;
  createdAt: number;
}

export interface TeamInvite {
  id: string;
  teamId: string;
  inviteCode: string;
  role: 'member' | 'viewer';
  expiresAt: number;
  createdAt: number;
}

export async function createTeam(team: Team): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO teams (id, name, sync_mode, encryption_key, owner_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      team.id,
      team.name,
      team.syncMode,
      team.encryptionKey || null,
      team.ownerId,
      team.createdAt,
      team.updatedAt
    ]
  );
}

export async function updateTeam(team: Team): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE teams SET name = ?, sync_mode = ?, encryption_key = ?, updated_at = ? WHERE id = ?`,
    [team.name, team.syncMode, team.encryptionKey || null, Date.now(), team.id]
  );
}

export async function deleteTeam(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM team_invites WHERE team_id = ?', [id]);
  await db.execute('DELETE FROM team_activities WHERE team_id = ?', [id]);
  await db.execute('DELETE FROM team_members WHERE team_id = ?', [id]);
  await db.execute('DELETE FROM teams WHERE id = ?', [id]);
}

export async function getTeams(): Promise<Team[]> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      id: string; name: string; sync_mode: string; encryption_key: string | null;
      owner_id: string; created_at: number; updated_at: number;
    }>
  >('SELECT * FROM teams ORDER BY updated_at DESC');

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    syncMode: r.sync_mode as Team['syncMode'],
    encryptionKey: r.encryption_key ?? undefined,
    ownerId: r.owner_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

export async function getTeam(id: string): Promise<Team | null> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      id: string; name: string; sync_mode: string; encryption_key: string | null;
      owner_id: string; created_at: number; updated_at: number;
    }>
  >('SELECT * FROM teams WHERE id = ?', [id]);

  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    syncMode: r.sync_mode as Team['syncMode'],
    encryptionKey: r.encryption_key ?? undefined,
    ownerId: r.owner_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export async function addTeamMember(member: TeamMember): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO team_members (team_id, user_id, user_name, role, joined_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      member.teamId,
      member.userId,
      member.userName,
      member.role,
      member.joinedAt,
      member.lastSeenAt || null
    ]
  );
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    'DELETE FROM team_members WHERE team_id = ? AND user_id = ?',
    [teamId, userId]
  );
}

export async function getTeamMembers(teamId: string): Promise<TeamMember[]> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      team_id: string; user_id: string; user_name: string; role: string;
      joined_at: number; last_seen_at: number | null;
    }>
  >('SELECT * FROM team_members WHERE team_id = ? ORDER BY joined_at ASC', [teamId]);

  return rows.map((r) => ({
    teamId: r.team_id,
    userId: r.user_id,
    userName: r.user_name,
    role: r.role as TeamMember['role'],
    joinedAt: r.joined_at,
    lastSeenAt: r.last_seen_at ?? undefined
  }));
}

export async function updateMemberRole(
  teamId: string,
  userId: string,
  role: TeamMember['role']
): Promise<void> {
  const db = await getDb();
  await db.execute(
    'UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?',
    [role, teamId, userId]
  );
}

export async function createTeamActivity(activity: TeamActivity): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO team_activities (team_id, user_id, user_name, activity_type, title, content, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      activity.teamId,
      activity.userId,
      activity.userName,
      activity.activityType,
      activity.title,
      activity.content || null,
      activity.metadata ? JSON.stringify(activity.metadata) : null,
      activity.createdAt
    ]
  );
  return result.lastInsertId ?? 0;
}

export async function getTeamActivities(
  teamId: string,
  limit: number = 50
): Promise<TeamActivity[]> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      id: number; team_id: string; user_id: string; user_name: string;
      activity_type: string; title: string; content: string | null;
      metadata: string | null; created_at: number;
    }>
  >(
    'SELECT * FROM team_activities WHERE team_id = ? ORDER BY created_at DESC LIMIT ?',
    [teamId, limit]
  );

  return rows.map((r) => ({
    id: r.id,
    teamId: r.team_id,
    userId: r.user_id,
    userName: r.user_name,
    activityType: r.activity_type,
    title: r.title,
    content: r.content ?? undefined,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    createdAt: r.created_at
  }));
}

export async function createTeamInvite(invite: TeamInvite): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO team_invites (id, team_id, invite_code, role, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [invite.id, invite.teamId, invite.inviteCode, invite.role, invite.expiresAt, invite.createdAt]
  );
}

export async function getTeamInviteByCode(code: string): Promise<TeamInvite | null> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      id: string; team_id: string; invite_code: string; role: string;
      expires_at: number; created_at: number;
    }>
  >('SELECT * FROM team_invites WHERE invite_code = ?', [code]);

  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    teamId: r.team_id,
    inviteCode: r.invite_code,
    role: r.role as TeamInvite['role'],
    expiresAt: r.expires_at,
    createdAt: r.created_at
  };
}

export async function deleteTeamInvite(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM team_invites WHERE id = ?', [id]);
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
  await db.execute('DELETE FROM reading_notes');
  await db.execute('DELETE FROM reading_sessions');
  await db.execute('DELETE FROM experiment_snapshots');
  await db.execute('DELETE FROM sentinel_papers');
  await db.execute('DELETE FROM sentinel_checks');
  await db.execute('DELETE FROM sentinel_topics');
  await db.execute('DELETE FROM plugin_settings');
  await db.execute('DELETE FROM plugins');
  await db.execute('DELETE FROM team_invites');
  await db.execute('DELETE FROM team_activities');
  await db.execute('DELETE FROM team_members');
  await db.execute('DELETE FROM teams');
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
