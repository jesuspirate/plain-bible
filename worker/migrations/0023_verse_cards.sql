-- Verse pictures sent for shared links' cards (POST /card), per network
-- address (a fingerprint of it, never the address), kept a day only to stop
-- anyone using the service to store other pictures.
CREATE TABLE card_sends (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX card_sends_ip ON card_sends(ip, at);
CREATE INDEX card_sends_at ON card_sends(at);
