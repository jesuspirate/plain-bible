-- How many use the app, counted without knowing who: one row per day, week
-- or month and kind of count ('day', 'new', 'home', 'week', 'month'), each
-- just a number. No ids, no addresses.
CREATE TABLE hello (
  period TEXT NOT NULL,
  kind TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (period, kind)
);
