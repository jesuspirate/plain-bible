-- Suggestions sent from Settings, per network address (a fingerprint of it,
-- never the address), kept a day only to stop spam. The words themselves
-- are never stored: they go by email and are gone.
CREATE TABLE suggest_sends (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX suggest_sends_ip ON suggest_sends(ip, at);
CREATE INDEX suggest_sends_at ON suggest_sends(at);
