-- Circles: a few people who share verses and prayers with each other. Like
-- synced prayers, everything a member shares is encrypted on their device
-- with the circle's key, which only members hold. The server sees who is in
-- a circle, when they share, and how big it is; never what.
CREATE TABLE circles (
  id TEXT PRIMARY KEY,
  -- the circle's name, sealed with the circle key
  name TEXT NOT NULL,
  created INTEGER NOT NULL
);
-- `mid` stands for the member inside the circle, so members never see each
-- other's account ids. `wrapped` is the circle key, locked with the member's
-- own key (the account's prayer key); `name` is how they're shown, sealed.
CREATE TABLE circle_members (
  circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mid TEXT NOT NULL,
  wrapped TEXT NOT NULL,
  name TEXT NOT NULL,
  joined INTEGER NOT NULL,
  PRIMARY KEY (circle_id, user_id)
);
CREATE INDEX circle_members_user ON circle_members(user_id);
-- An invite link holds a secret that never reaches the server; `wrapped` is
-- the circle key locked with it. Each invite works once.
CREATE TABLE circle_invites (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  wrapped TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX circle_invites_circle ON circle_invites(circle_id);
-- Something shared: a sealed body, plus the sealed audio of a prayer in chunks.
CREATE TABLE circle_items (
  circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  body TEXT NOT NULL,
  chunks INTEGER NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (circle_id, id)
);
CREATE TABLE circle_chunks (
  circle_id TEXT NOT NULL,
  item TEXT NOT NULL,
  n INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (circle_id, item, n)
);
-- "Praying with you": a 🙏 from a member on something shared.
CREATE TABLE circle_amens (
  circle_id TEXT NOT NULL,
  item TEXT NOT NULL,
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (circle_id, item, user_id)
);
-- A few words back on something shared ("praying for you, Mom"), sealed too.
CREATE TABLE circle_replies (
  circle_id TEXT NOT NULL,
  item TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (circle_id, item, id)
);
