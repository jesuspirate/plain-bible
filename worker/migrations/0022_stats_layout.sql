-- How the maker chose to show tiles on his numbers page (/stats), by name:
-- 'hide' (never) or 'show' (even at 0). Tiles not listed show unless 0.
CREATE TABLE stats_layout (
  id TEXT PRIMARY KEY,
  how TEXT NOT NULL
);
