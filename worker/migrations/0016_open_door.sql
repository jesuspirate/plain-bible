-- Open door circles: a circle someone leads (a podcast, a ministry), which
-- people join through one link the leader shares, until the leader closes
-- it. Only the leader shares. The others can pray with what's shared (🙏)
-- and send the leader a prayer request nobody else sees. They never see or
-- hear from each other.
--
-- `leader`: the account leading it (NULL for an ordinary circle).
-- `door_pub`: the leader's public key, which prayer requests are sealed to,
-- so only the leader can open them; `door_priv` is its private half, locked
-- with the leader's own account key.
-- `door_id`, `door_wrapped`: the open link, and the circle key locked with
-- the secret in the link (after the #, so it never comes here). NULL: the
-- door is closed. `door_link`: that secret, sealed with the circle key, so
-- the leader's other devices can share the same link again.
ALTER TABLE circles ADD COLUMN leader TEXT;
ALTER TABLE circles ADD COLUMN door_pub TEXT;
ALTER TABLE circles ADD COLUMN door_priv TEXT;
ALTER TABLE circles ADD COLUMN door_id TEXT;
ALTER TABLE circles ADD COLUMN door_wrapped TEXT;
ALTER TABLE circles ADD COLUMN door_link TEXT;
CREATE UNIQUE INDEX circles_door ON circles(door_id);

-- A prayer request to the leader, sealed to the leader's key (`epk` is the
-- sender's one-time public key). `prayed`: when the leader said they prayed.
CREATE TABLE circle_requests (
  circle_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  epk TEXT NOT NULL,
  body TEXT NOT NULL,
  prayed INTEGER,
  PRIMARY KEY (circle_id, id)
);
CREATE INDEX circle_requests_user ON circle_requests(user_id, at);

-- Taken out by the leader: the open link no longer lets them back in.
CREATE TABLE circle_door_bans (
  circle_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (circle_id, user_id)
);

-- Who may lead an Open door circle: asked from the app, allowed by the
-- app's maker on the private /stats page. `note`: what they lead, in their words.
CREATE TABLE door_leaders (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  asked INTEGER NOT NULL,
  allowed INTEGER,
  note TEXT
);
