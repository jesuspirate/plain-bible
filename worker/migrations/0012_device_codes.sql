-- Signing in another device with a code. A signed-in device makes a 6-digit
-- code; the new device types it, which leaves a public key; the signed-in
-- device allows it and seals a sign-in (and the prayer key) to that key.
-- The server only ever holds what it can't open.
CREATE TABLE device_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pub TEXT,
  label TEXT,
  epk TEXT,
  sealed TEXT,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX device_codes_user ON device_codes(user_id, expires);

-- Wrong codes typed on a device that isn't signed in, by network address.
CREATE TABLE device_code_misses (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX device_code_misses_ip ON device_code_misses(ip, at);
