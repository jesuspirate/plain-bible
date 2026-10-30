-- A name for each passkey, so one account's passkeys from several password
-- managers can be told apart. Guessed from the authenticator when it's made
-- (see KNOWN in src/index.ts); the member can change it.
ALTER TABLE credentials ADD COLUMN name TEXT;
