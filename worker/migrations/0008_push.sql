-- Notifications: a device that asked to hear when there's something new in
-- some of its circles. `endpoint` is the browser's push address for that
-- device; `p256dh` and `auth` are its keys, which every message is
-- encrypted with. A message says only which circle, never what.
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX push_subs_user ON push_subs(user_id);
-- The circles each device hears about, and when it was last told (so a
-- few things shared in a row make one notification, not several).
CREATE TABLE push_circles (
  endpoint TEXT NOT NULL,
  circle_id TEXT NOT NULL,
  sent INTEGER,
  PRIMARY KEY (endpoint, circle_id)
);
CREATE INDEX push_circles_circle ON push_circles(circle_id);
