CREATE TABLE codeget_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id TEXT UNIQUE REFERENCES code_claims(id) ON DELETE SET NULL,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  real_name TEXT NOT NULL DEFAULT '',
  class_name TEXT NOT NULL DEFAULT '',
  ip_address TEXT,
  ip_hash TEXT NOT NULL,
  fingerprint TEXT,
  fingerprint_hash TEXT,
  device_hash TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('issued', 'needs_class', 'rejected', 'error')),
  http_status INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_codeget_logs_created ON codeget_logs(created_at, id);
CREATE INDEX idx_codeget_logs_outcome ON codeget_logs(outcome, created_at, id);

INSERT INTO codeget_logs (claim_id, student_id, real_name, class_name, ip_hash, fingerprint_hash, device_hash, outcome, http_status, reason, created_at)
SELECT r.id, r.student_id, COALESCE(s.real_name, ''), COALESCE(c.class_name, ''), r.ip_hash, r.fingerprint_hash, r.device_hash,
  'issued', 201, '历史成功领取：仅存来源哈希，实际 IP 和原始浏览器指纹无法还原。', r.created_at
FROM code_claims r LEFT JOIN students s ON s.id = r.student_id LEFT JOIN classes c ON c.id = s.class_id;
