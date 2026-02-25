import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

// On Railway, use the mounted volume path. Locally, use ./data
const DATA_DIR = process.env.DB_PATH
  ? process.env.DB_PATH
  : join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'cib.db');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      sources TEXT,
      discrepancies TEXT,
      confidence REAL
    );

    CREATE TABLE IF NOT EXISTS discrepancies (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      documented TEXT NOT NULL,
      actual TEXT NOT NULL,
      sources TEXT NOT NULL,
      recommendation TEXT,
      resolved INTEGER DEFAULT 0,
      detected_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS github_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      author TEXT,
      date TEXT NOT NULL,
      url TEXT,
      technologies TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS github_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS jira_issues (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      summary TEXT NOT NULL,
      description TEXT,
      status TEXT,
      priority TEXT,
      assignee TEXT,
      updated TEXT,
      url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS confluence_pages (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      space TEXT,
      updated TEXT,
      author TEXT,
      url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS slack_messages (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      user TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      thread_ts TEXT,
      url TEXT,
      is_decision INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teams_messages (
      id TEXT PRIMARY KEY,
      team TEXT NOT NULL,
      channel TEXT NOT NULL,
      user TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      url TEXT,
      is_decision INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      avatar_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ─── Message helpers ───

export interface DbMessage {
  id: string;
  channel: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: string[];
  discrepancies?: DbDiscrepancy[];
  confidence?: number;
}

export function insertMessage(msg: DbMessage): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO messages (id, channel, role, content, timestamp, sources, discrepancies, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.id,
    msg.channel,
    msg.role,
    msg.content,
    msg.timestamp,
    msg.sources ? JSON.stringify(msg.sources) : null,
    msg.discrepancies ? JSON.stringify(msg.discrepancies) : null,
    msg.confidence ?? null,
  );
}

export function getMessagesByChannel(channel: string): DbMessage[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM messages WHERE channel = ? ORDER BY timestamp ASC
  `).all(channel) as Array<{
    id: string; channel: string; role: string; content: string;
    timestamp: string; sources: string | null; discrepancies: string | null; confidence: number | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    role: r.role as 'user' | 'assistant',
    content: r.content,
    timestamp: r.timestamp,
    sources: r.sources ? JSON.parse(r.sources) : undefined,
    discrepancies: r.discrepancies ? JSON.parse(r.discrepancies) : undefined,
    confidence: r.confidence ?? undefined,
  }));
}

// ─── Discrepancy helpers ───

export interface DbDiscrepancy {
  id: string;
  type: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  documented: string;
  actual: string;
  sources: string[];
  recommendation?: string;
  resolved: boolean;
  detected_at: string;
  resolved_at?: string;
}

export function insertDiscrepancy(d: DbDiscrepancy): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO discrepancies
    (id, type, severity, title, documented, actual, sources, recommendation, resolved, detected_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    d.id, d.type, d.severity, d.title, d.documented, d.actual,
    JSON.stringify(d.sources), d.recommendation ?? null,
    d.resolved ? 1 : 0, d.detected_at, d.resolved_at ?? null,
  );
}

export function getDiscrepancies(resolvedFilter?: boolean): DbDiscrepancy[] {
  const db = getDb();
  let query = 'SELECT * FROM discrepancies';
  const params: unknown[] = [];
  if (resolvedFilter !== undefined) {
    query += ' WHERE resolved = ?';
    params.push(resolvedFilter ? 1 : 0);
  }
  query += ' ORDER BY detected_at DESC';

  const rows = db.prepare(query).all(...params) as Array<{
    id: string; type: string; severity: string; title: string;
    documented: string; actual: string; sources: string;
    recommendation: string | null; resolved: number;
    detected_at: string; resolved_at: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    severity: r.severity as 'high' | 'medium' | 'low',
    title: r.title,
    documented: r.documented,
    actual: r.actual,
    sources: JSON.parse(r.sources),
    recommendation: r.recommendation ?? undefined,
    resolved: r.resolved === 1,
    detected_at: r.detected_at,
    resolved_at: r.resolved_at ?? undefined,
  }));
}

export function resolveDiscrepancy(id: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE discrepancies SET resolved = 1, resolved_at = ? WHERE id = ?
  `).run(new Date().toISOString(), id);
}

export function getUnresolvedDiscrepancyCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM discrepancies WHERE resolved = 0').get() as { count: number };
  return row.count;
}

// ─── Low-level db accessor (for integrations that need run/all) ───

export const db = {
  run(sql: string, params: unknown[] = []): void {
    getDb().prepare(sql).run(...params);
  },
  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return getDb().prepare(sql).all(...params) as T[];
  },
  get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
    return getDb().prepare(sql).get(...params) as T | undefined;
  },
};
