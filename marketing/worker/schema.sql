CREATE TABLE IF NOT EXISTS registrants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT DEFAULT 'landing'
);
