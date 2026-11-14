PRAGMA foreign_keys = ON;

CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL UNIQUE CHECK(length(class_name) BETWEEN 1 AND 120),
  teacher_name TEXT NOT NULL DEFAULT '' CHECK(length(teacher_name) <= 80),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  real_name TEXT NOT NULL CHECK(length(real_name) BETWEEN 1 AND 80),
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  student_code TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK(verification_status IN ('unverified','verified')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(class_id, real_name)
);
CREATE TABLE admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','moderator')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL UNIQUE REFERENCES students(id) ON DELETE RESTRICT,
  content TEXT NOT NULL CHECK(length(content) BETWEEN 10 AND 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','hidden')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER messages_display_order AFTER INSERT ON messages
BEGIN
  UPDATE messages SET display_order = NEW.id WHERE id = NEW.id;
END;
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE student_sessions (
  token_hash TEXT PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  site_title TEXT NOT NULL DEFAULT '师恩难忘',
  teacher_name TEXT NOT NULL DEFAULT '敬爱的老师',
  homepage_copy TEXT NOT NULL DEFAULT '那些被照亮的日子，值得一句认真说出的谢谢。把你的感谢写在这里，让心意慢慢汇成一颗心。',
  submissions_open INTEGER NOT NULL DEFAULT 1 CHECK(submissions_open IN (0,1)),
  name_display TEXT NOT NULL DEFAULT 'masked' CHECK(name_display IN ('full','masked','anonymous'))
);
INSERT INTO settings (id) VALUES (1);
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_students_class ON students(class_id);
CREATE INDEX idx_messages_public ON messages(status, display_order, id);
CREATE INDEX idx_messages_created ON messages(status, created_at);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_admin_sessions_expiry ON admin_sessions(expires_at);
CREATE INDEX idx_student_sessions_expiry ON student_sessions(expires_at);
CREATE INDEX idx_rates_expiry ON rate_limits(expires_at);
