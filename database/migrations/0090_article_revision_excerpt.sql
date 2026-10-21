-- Keep the source excerpt attached to each exact material version for history and provenance.
ALTER TABLE article_revisions ADD COLUMN excerpt text;

-- Recover the current version only when its stored content hash proves it is the same snapshot.
UPDATE article_revisions r SET excerpt = a.excerpt
FROM articles a
WHERE r.article_id = a.id AND r.revision = a.revision
  AND r.content_hash = a.content_hash AND r.excerpt IS NULL AND a.excerpt IS NOT NULL;
