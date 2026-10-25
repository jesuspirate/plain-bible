-- Reactions on something shared: ❤️ love, 💪 strength, 🙌 encouragement (🙏
-- stays in circle_amens). One row per member and item, holding which of
-- them they gave, sealed with the circle key, so the server sees only that
-- someone reacted, and when they last added one.
CREATE TABLE circle_reacts (
  circle_id TEXT NOT NULL,
  item TEXT NOT NULL,
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (circle_id, item, user_id)
);
