-- Sign-in by email, for those who'd rather not rely on a passkey alone. The
-- address itself is never stored: only a keyed fingerprint to find the
-- account, and a hint like "j•••@gmail.com" to show which one it was.
CREATE TABLE emails (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  hint TEXT NOT NULL,
  created INTEGER NOT NULL
);
-- A 6-digit code sent to an address, waiting to be typed in. user_id is set
-- when adding the address to a signed-in account.
CREATE TABLE email_codes (
  hash TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  user_id TEXT,
  tries INTEGER NOT NULL DEFAULT 0,
  expires INTEGER NOT NULL
);
-- Codes sent in the last day, to keep anyone from flooding an inbox.
CREATE TABLE email_sends (
  hash TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX email_sends_at ON email_sends(at);
CREATE INDEX email_sends_hash ON email_sends(hash, at);
