-- Public accounts use D1 for ciphertext as well as metadata. No R2 subscription is needed.
CREATE TABLE cloud_plans (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  size INTEGER NOT NULL,
  body BLOB,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, plan_id)
);
CREATE TABLE account_recovery (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL
);
CREATE TABLE request_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX request_limits_expiry ON request_limits(expires_at);
