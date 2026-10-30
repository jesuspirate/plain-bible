-- Which passkey a sign-in used, so Settings → Account can mark "This one"
-- (sign-ins by email code, or carried over from another device, have none).
-- And the domain each passkey belongs to, learned when it's made or used:
-- the app moved from bible.chama.community, and both kinds can be saved.
ALTER TABLE sessions ADD COLUMN cred_id TEXT;
ALTER TABLE credentials ADD COLUMN rp_id TEXT;
