-- The app's language when someone asked to lead an Open door circle, so the
-- notice that they can lead one now is in their words (en, fr or es).
ALTER TABLE door_leaders ADD COLUMN lang TEXT;
