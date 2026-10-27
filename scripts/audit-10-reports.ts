import { sql } from "../packages/backend/src/db.ts";

async function main() {
  const rows = await sql<any[]>`
    SELECT id, kind, key, window_start, window_end, generated_at, model, origin, revision, updated_at, content
    FROM reports
    ORDER BY kind, key
  `;
  console.log(`TOTAL REPORTS FOUND: ${rows.length}\n`);

  for (const r of rows) {
    const c = r.content || {};
    const sectionCount = (c.sections || c.themes || []).length;
    let itemCount = 0;
    const itemTitles: string[] = [];
    if (r.kind === "daily") {
      for (const s of c.sections || []) {
        for (const it of s.items || []) {
          itemCount++;
          itemTitles.push(`[${it.sourceId || it.sourceName}] ${it.title} (publishedAt=${it.publishedAt})`);
        }
      }
    } else {
      for (const t of c.themes || []) {
        for (const it of t.storyRefs || []) {
          itemCount++;
          itemTitles.push(`[${it.sourceId || it.sourceName}] ${it.title} (publishedAt=${it.publishedAt})`);
        }
      }
    }

    console.log(`================================================================`);
    console.log(`ID: ${r.id} | Kind: ${r.kind} | Key: ${r.key}`);
    console.log(`Window: ${r.window_start?.toISOString()} to ${r.window_end?.toISOString()}`);
    console.log(`Generated At: ${r.generated_at?.toISOString()}`);
    console.log(`Updated At: ${r.updated_at?.toISOString()}`);
    console.log(`Model: ${r.model} | Origin: ${r.origin} | Revision: ${r.revision}`);
    console.log(`Headline / Title: ${c.headline || c.title || c.lead?.title}`);
    console.log(`Overview: ${c.overview || "null"}`);
    console.log(`Is Quiet Issue: ${itemCount === 0 && r.kind === "daily"}`);
    console.log(`Sections/Themes: ${sectionCount} | Items Count: ${itemCount}`);
    console.log(`Lead Item ID: ${c.leadItemId || "none"}`);
    console.log(`Generator Meta: ${JSON.stringify(c.generator)}`);
    console.log(`Metrics: ${JSON.stringify(c.metrics)}`);
    console.log(`Items Details:`);
    for (const it of itemTitles.slice(0, 5)) {
      console.log(`   - ${it}`);
    }
    if (itemTitles.length > 5) {
      console.log(`   ... and ${itemTitles.length - 5} more items`);
    }
    console.log("");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
