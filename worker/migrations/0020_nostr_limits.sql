-- Nostr sign-ins per network address (a fingerprint of it, never the
-- address): tries (made = 0) and new accounts (made = 1), kept a day.
CREATE TABLE nostr_tries (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL,
  made INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX nostr_tries_ip ON nostr_tries(ip, made, at);
