-- Sign-in with a Nostr key, offered only inside Fedi (its mini apps have no
-- passkeys, and a code by email is clumsy there). Only the public key is
-- kept: it is already public, and it says nothing else about the person.
CREATE TABLE nostr_keys (
  pubkey TEXT PRIMARY KEY,        -- 64 hex characters (x-only, BIP-340)
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  last_used INTEGER
);
