-- One account can be signed in to from several Fedi apps (each has its own
-- Nostr key), like having several passkeys. SQLite can't drop the UNIQUE on
-- user_id in place, so the table is made again with the same rows.
CREATE TABLE nostr_keys_new (
  pubkey TEXT PRIMARY KEY,        -- 64 hex characters (x-only, BIP-340)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  last_used INTEGER
);
INSERT INTO nostr_keys_new (pubkey, user_id, created, last_used) SELECT pubkey, user_id, created, last_used FROM nostr_keys;
DROP TABLE nostr_keys;
ALTER TABLE nostr_keys_new RENAME TO nostr_keys;
CREATE INDEX nostr_keys_user ON nostr_keys(user_id);
