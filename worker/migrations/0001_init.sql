CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created INTEGER NOT NULL
);
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,            -- base64url credential id
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,       -- base64url COSE public key
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created INTEGER NOT NULL,
  last_used INTEGER
);
CREATE INDEX credentials_user ON credentials(user_id);
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  user_id TEXT,                   -- set when adding a passkey to an existing account
  expires INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE data (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  rev INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
