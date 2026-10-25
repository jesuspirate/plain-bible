-- A new device asking one that already holds the account key to pass it on
-- ("Allow your new phone?"). The new device leaves a public key; the old one
-- seals the account key to it. The server only ever holds what it can't open.
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pub TEXT NOT NULL,
  label TEXT NOT NULL,
  epk TEXT,
  sealed TEXT,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX approvals_user ON approvals(user_id, expires);
