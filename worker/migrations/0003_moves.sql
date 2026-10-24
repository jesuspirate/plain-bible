-- Moving to a new web address. Browsers keep each address's data apart, so
-- the old address packs everything on the device (highlights, notes,
-- settings, prayers), encrypts it with a key that stays in the move link,
-- and leaves it here for a few days for the new address to pick up. The
-- server only ever holds bytes it can't read.
CREATE TABLE moves (
  id TEXT NOT NULL,
  n INTEGER NOT NULL,
  of INTEGER NOT NULL,
  data BLOB NOT NULL,
  expires INTEGER NOT NULL,
  PRIMARY KEY (id, n)
);
CREATE INDEX moves_expires ON moves(expires);
