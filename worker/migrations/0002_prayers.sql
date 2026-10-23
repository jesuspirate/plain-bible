-- Spoken prayers, synced only if the user turns it on. Everything here is
-- encrypted on the device first; the server stores bytes it cannot read.
-- key_id is a fingerprint of the account's prayer key, so a device can tell
-- whether the key it holds is the right one; it reveals nothing of the key.
CREATE TABLE prayer_keys (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL,
  created INTEGER NOT NULL
);
-- The prayer key, wrapped with a secret only the passkey can produce (the
-- WebAuthn PRF extension), one per passkey.
CREATE TABLE prayer_wraps (
  cred_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wrapped TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX prayer_wraps_user ON prayer_wraps(user_id);
-- A prayer is one or more parts (it can be picked up again after the phone
-- locks); each part is stored in chunks small enough for a row.
CREATE TABLE prayer_parts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prayer TEXT NOT NULL,
  part INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  size INTEGER NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (user_id, prayer, part)
);
CREATE TABLE prayer_chunks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prayer TEXT NOT NULL,
  part INTEGER NOT NULL,
  n INTEGER NOT NULL,
  of INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (user_id, prayer, part, n)
);
-- Prayers deleted on one device, so the others delete them too.
CREATE TABLE prayer_gone (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prayer TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, prayer)
);
