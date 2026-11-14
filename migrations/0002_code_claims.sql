CREATE TABLE code_claims (
  id TEXT PRIMARY KEY,
  student_id INTEGER UNIQUE REFERENCES students(id) ON DELETE SET NULL,
  ip_hash TEXT NOT NULL UNIQUE,
  fingerprint_hash TEXT NOT NULL UNIQUE,
  device_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
