// The industry lane's event wiring on the engine's existing story model.
//
// An event is not an article. Articles that state the same concrete change are grouped under one
// story (deterministic event key), each keeps its own row and its own attribution, and the story
// carries facts — subject, action, object, time — with the articles that support them. Corrections
// are structural: a wrong merge is undone by `merged_into`, never by deleting an article.
import { sql } from "../db.ts";
import { sha256 } from "../lib/ids.ts";
import { type IndustryTheme } from "../sources/industry-lane.ts";

export interface IndustryFactInput {
  subject: string | null;
  action: string | null;
  object: string | null;
  time: string | null;
}

export interface EnsureStoryInput {
  eventKey: string;
  theme: IndustryTheme;
  title: string;
  articleId: string;
  publishedAt: Date | null;
  /** The concrete change the article states; null fields stay null, never guessed. */
  fact?: IndustryFactInput | null;
  /** The article's role under this fact: the report that states it, or a mention. */
  role?: "primary" | "report" | "mention";
}

/**
 * Finds the story this event key belongs to, or opens it. Two articles with the same key share the
 * story; different keys never share one. The story's frame keeps the key, the theme and the kind so
 * the read layer can group and filter without re-deriving anything.
 */
export async function ensureIndustryStory(input: EnsureStoryInput): Promise<number> {
  return sql.begin(async (tx) => {
    const [existing] = await tx<{ id: number }[]>`
      SELECT id FROM stories WHERE frame->>'eventKey' = ${input.eventKey} AND merged_into IS NULL LIMIT 1`;
    let storyId: number;
    if (existing) {
      storyId = existing.id;
      await tx`UPDATE stories SET latest_at = greatest(latest_at, ${input.publishedAt ?? new Date()}), updated_at = now() WHERE id = ${storyId}`;
    } else {
      const [created] = await tx<{ id: number }[]>`
        INSERT INTO stories (public_id, title, action, frame, first_report_at, latest_at, origin)
        VALUES (gen_random_uuid(), ${input.title}, null,
                ${tx.json({ eventKey: input.eventKey, theme: input.theme, lane: "industry" })},
                ${input.publishedAt ?? new Date()}, ${input.publishedAt ?? new Date()}, 'manual')
        RETURNING id`;
      storyId = created!.id;
    }

    // One fact per story per new article version: the concrete change, with the article that states
    // it. A fact without a subject/action says so — nothing is invented to fill the fields.
    const factTitle = input.fact?.subject && input.fact?.action
      ? `${input.fact.subject} ${input.fact.action}${input.fact.object ? ` ${input.fact.object}` : ""}`
      : input.title;
    const occurredAt = input.publishedAt ?? new Date();
    let [fact] = await tx<{ id: number }[]>`
      INSERT INTO facts (public_id, story_id, title, subject, action, object, conditions, occurred_at, manual)
      VALUES (${sha256(`${storyId}:${input.articleId}:${occurredAt.toISOString()}`).slice(0, 32)}, ${storyId}, ${factTitle},
              ${input.fact?.subject ?? null}, ${input.fact?.action ?? null}, ${input.fact?.object ?? null},
              ${input.fact?.time ?? null}, ${occurredAt}, false)
      ON CONFLICT (public_id) DO NOTHING
      RETURNING id`;
    if (!fact) {
      [fact] = await tx<{ id: number }[]>`SELECT id FROM facts WHERE public_id = ${sha256(`${storyId}:${input.articleId}:${occurredAt.toISOString()}`).slice(0, 32)}`;
    }
    await tx`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${input.articleId}, ${input.role ?? "report"})
             ON CONFLICT (fact_id, article_id) DO NOTHING`;

    // The article's publication carries the story link, so the existing readers see the grouping.
    await tx`UPDATE publications SET story_id = ${storyId} WHERE article_id = ${input.articleId} AND story_id IS NULL`;
    return storyId;
  });
}

/**
 * The industry lane has no content.analyze pass, so its admitted items need their publication row
 * created here: one per article, public, carrying the story link. Industry sources' tags keep them
 * out of the first lane's pages; this row is what the industry read layer and the story link join on.
 */
export async function ensureIndustryPublication(input: {
  articleId: string; sourceId: string; title: string; url: string; publishedAt: Date | null; storyId: number;
}): Promise<void> {
  const at = input.publishedAt ?? new Date();
  await sql`
    INSERT INTO publications (article_id, source_id, title, url, visibility, channel, discovered_at, timeline_at, sort_at, story_id)
    VALUES (${input.articleId}, ${input.sourceId}, ${input.title}, ${input.url}, 'public', 'news', ${at}, ${at}, ${at}, ${input.storyId})
    ON CONFLICT (article_id) DO UPDATE SET story_id = coalesce(publications.story_id, ${input.storyId})`;
}

/**
 * Undoes a wrong merge without touching any article: the story is marked merged into the survivor,
 * its old public id becomes an alias that answers to the survivor, and its facts are moved. The
 * change is recorded on the frame; the articles keep every version they ever had.
 */
export async function mergeIndustryStory(duplicateId: number, survivorId: number, reason: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    if (duplicateId === survivorId) return false;
    const [dup] = await tx<{ id: number; public_id: string; merged_into: number | null }[]>`SELECT id, public_id, merged_into FROM stories WHERE id = ${duplicateId} FOR UPDATE`;
    const [survivor] = await tx<{ id: number }[]>`SELECT id FROM stories WHERE id = ${survivorId} FOR UPDATE`;
    if (!dup || !survivor) return false;
    if (dup.merged_into !== null) return false;
    await tx`UPDATE stories SET merged_into = ${survivorId}, frame = frame || ${tx.json({ mergedFrom: duplicateId, mergeReason: reason })}::jsonb, updated_at = now() WHERE id = ${duplicateId}`;
    await tx`INSERT INTO story_aliases (public_id, story_id) VALUES (${dup.public_id}, ${survivorId}) ON CONFLICT (public_id) DO NOTHING`;
    await tx`UPDATE facts SET story_id = ${survivorId} WHERE story_id = ${duplicateId}`;
    await tx`UPDATE publications SET story_id = ${survivorId} WHERE story_id = ${duplicateId}`;
    return true;
  });
}

/** One day's picks, archived with the material versions and the reason each was chosen. */
export interface IndustryPickRecord {
  day: string;
  storyId: number;
  eventKey: string;
  theme: string;
  title: string;
  quick: string | null;
  reason: string;
  articleIds: string[];
  digestVersion: number | null;
}

/**
 * Writes one day's picks. Running the same day again replaces that day's rows (same picks, no new
 * spend); a later day writes new rows. The row keeps the digest version it was built from, so an
 * archived pick shows what was known then, not what was revised later.
 */
export async function saveIndustryPicks(day: string, picks: IndustryPickRecord[]): Promise<number> {
  return sql.begin(async (tx) => {
    await tx`DELETE FROM industry_daily_picks WHERE day = ${day}`;
    for (const p of picks) {
      await tx`INSERT INTO industry_daily_picks (day, story_id, event_key, theme, title, quick, reason, article_ids, digest_version)
               VALUES (${day}, ${p.storyId}, ${p.eventKey}, ${p.theme}, ${p.title}, ${p.quick}, ${p.reason}, ${p.articleIds}, ${p.digestVersion})`;
    }
    return picks.length;
  });
}
