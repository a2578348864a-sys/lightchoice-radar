-- The daily picks are a new, empty table: the unique index is built CONCURRENTLY per the online
-- migration convention, so no lock ever blocks another lane's traffic.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS industry_daily_picks_day_story_uq
  ON industry_daily_picks (day, story_id);
