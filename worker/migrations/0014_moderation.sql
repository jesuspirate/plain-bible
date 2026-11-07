-- Keeping circles kind (App Store guideline 1.2).
--
-- A block: `user_id` no longer sees what the member `mid` shares or writes
-- in that circle, and isn't told about it. The blocked person isn't told.
CREATE TABLE circle_blocks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  mid TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, circle_id, mid)
);

-- A report, for the app's maker to look at (on the private /stats page).
-- Everything shared is sealed, so `what` is the words the person reporting
-- chose to send: what they saw, opened on their own device. `about` is the
-- account behind the member, so the maker can take them out of the circle.
CREATE TABLE circle_reports (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL,
  by_user TEXT NOT NULL,
  about TEXT NOT NULL,
  item TEXT,
  reply TEXT,
  what TEXT NOT NULL,
  at INTEGER NOT NULL,
  done INTEGER
);
CREATE INDEX circle_reports_open ON circle_reports(done, at);
