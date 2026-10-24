-- Streaks a member chose to show their circle: sealed with the circle key
-- like everything else, so the server can't read them. Empty unless that
-- member turned it on for this circle.
ALTER TABLE circle_members ADD COLUMN streak TEXT;
ALTER TABLE circle_members ADD COLUMN streak_at INTEGER;
