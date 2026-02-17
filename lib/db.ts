import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || '/tmp/analytics.db';
let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS hourly_aggregates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hour TEXT NOT NULL,
      service TEXT NOT NULL,
      total_requests INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      avg_response_ms REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(hour, service)
    );
    CREATE INDEX IF NOT EXISTS idx_agg_hour ON hourly_aggregates(hour, service);
  `);
  return _db;
}
