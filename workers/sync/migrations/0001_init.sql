-- Sync metadata. The server only ever stores ciphertext and wrapped keys (plan §12).
-- Every table is keyed by user_id, and every query in src/ filters on it.

CREATE TABLE plans (
  user_id    TEXT    NOT NULL,
  plan_id    TEXT    NOT NULL,
  version    INTEGER NOT NULL,           -- starts at 1, +1 on every write or delete
  updated_at TEXT    NOT NULL,           -- ISO 8601 UTC
  size       INTEGER NOT NULL,           -- ciphertext bytes (0 for a tombstone)
  r2_key     TEXT    NOT NULL,           -- <user_id>/<plan_id>/<version>, '' for a tombstone
  deleted    INTEGER NOT NULL DEFAULT 0, -- 1 = tombstone
  PRIMARY KEY (user_id, plan_id)
);

-- The user's wrapped key bundle (JSON, base64-encoded; opaque to the server).
CREATE TABLE key_bundles (
  user_id    TEXT    NOT NULL PRIMARY KEY,
  version    INTEGER NOT NULL,
  updated_at TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  body       TEXT    NOT NULL
);

-- One small encrypted settings blob per user (base64-encoded; opaque to the server).
CREATE TABLE settings (
  user_id    TEXT    NOT NULL PRIMARY KEY,
  version    INTEGER NOT NULL,
  updated_at TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  body       TEXT    NOT NULL
);
