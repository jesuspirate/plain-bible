-- Joining a circle with a 6-digit code instead of a link. The code only
-- finds the request: the person joining leaves a public key, the member who
-- made the code taps Allow, and their device seals the circle key to it. The
-- server only ever holds what it can't open. Codes last 15 minutes.
CREATE TABLE circle_codes (
  code TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joiner TEXT REFERENCES users(id) ON DELETE CASCADE,
  pub TEXT,
  label TEXT,
  epk TEXT,
  sealed TEXT,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX circle_codes_circle ON circle_codes(circle_id, expires);
-- Wrong codes typed, so codes can't be guessed by trying them all.
CREATE TABLE circle_code_misses (
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX circle_code_misses_user ON circle_code_misses(user_id, at);
