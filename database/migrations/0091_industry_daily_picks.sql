-- The second lane's daily picks: one row per picked event per day, archived with the digest version
-- it was built from, so a past pick keeps showing what was known then. Re-running a day replaces
-- that day's rows. Never touches any other lane's tables.
CREATE TABLE industry_daily_picks (
  id             bigserial PRIMARY KEY,
  day            date NOT NULL,
  story_id       bigint NOT NULL REFERENCES stories (id),
  event_key      text NOT NULL,
  theme          text NOT NULL,
  title          text NOT NULL,
  quick          text,
  reason         text NOT NULL,
  article_ids    text[] NOT NULL DEFAULT '{}',
  digest_version integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);
