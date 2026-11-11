-- Limits per network address (a fingerprint of it, never the address).
-- Sign-in emails: a few people can't use up the day's sends for everyone.
ALTER TABLE email_sends ADD COLUMN ip TEXT;
CREATE INDEX email_sends_ip ON email_sends(ip, at);
-- Device links: anyone may leave one, so they're capped per address and in
-- all, by size.
ALTER TABLE moves ADD COLUMN ip TEXT;
ALTER TABLE moves ADD COLUMN size INTEGER NOT NULL DEFAULT 0;
CREATE INDEX moves_ip ON moves(ip, expires);
