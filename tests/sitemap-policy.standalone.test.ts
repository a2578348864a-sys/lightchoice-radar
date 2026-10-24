import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromAmazonBlogSitemap, sitemapLastmodAdvanced, type SitemapDocument } from "@aihot/backend/sources/web-list";

const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as { sources: Array<Record<string, any>> };
const configuredSource = pack.sources.find((item) => item.id === "amazon-us-announcements")!;
const source = {
  ...configuredSource,
  config: { ...configuredSource.config, url: "https://sell.amazon.com/blog/sitemap.xml", parseMode: "sitemap" },
};
const xml = (body: string, url: string): SitemapDocument => ({ status: 200, url, contentType: "application/xml; charset=utf-8", text: body });

test("Amazon sitemap follows only bounded official monthly paths and keeps lastmod separate from publication date", async () => {
  const calls: string[] = [];
  const child = "https://sell.amazon.com/blog/sitemap-202610.xml";
  const items = await fromAmazonBlogSitemap(source as never, async (url) => {
    calls.push(url);
    if (url === "https://sell.amazon.com/blog/sitemap.xml") return xml(`<?xml version="1.0"?><sitemapindex>
      <sitemap><loc>${child}</loc><lastmod>2026-10-21T09:00:00Z</lastmod></sitemap>
      <sitemap><loc>https://sell.amazon.com.evil/blog/sitemap-202610.xml</loc><lastmod>2026-10-22</lastmod></sitemap>
      <sitemap><loc>https://sell.amazon.com/blog/sitemap-202610.xml?x=1</loc></sitemap>
    </sitemapindex>`, url);
    return xml(`<?xml version="1.0"?><urlset>
      <url><loc>https://sell.amazon.com/blog/announcements/a-policy-change</loc><lastmod>2026-10-20T14:30:00Z</lastmod></url>
      <url><loc>https://example.com/blog/not-amazon</loc><lastmod>2026-10-20</lastmod></url>
      <url><loc>https://sell.amazon.com/blog/sitemap-202610.xml</loc></url>
    </urlset>`, url);
  });
  assert.deepEqual(calls, ["https://sell.amazon.com/blog/sitemap.xml", child]);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.url, "https://sell.amazon.com/blog/announcements/a-policy-change");
  assert.equal(items[0]!.publishedAt, null, "Sitemap lastmod is not a publication date");
  assert.equal(items[0]!.sourceUpdatedAt?.toISOString(), "2026-10-20T14:30:00.000Z");
});

test("Amazon sitemap fails closed on HTML child responses, excessive nesting and oversized article lists", async () => {
  await assert.rejects(fromAmazonBlogSitemap(source as never, async (url) => ({
    status: 200, url, contentType: "text/html; charset=UTF-8", text: "<html>not a sitemap</html>",
  })), /not XML/);

  await assert.rejects(fromAmazonBlogSitemap(source as never, async (url) => {
    const level = url === "https://sell.amazon.com/blog/sitemap.xml" ? 0 : url.endsWith("sitemap-202610.xml") ? 1 : 2;
    const child = level === 0 ? "https://sell.amazon.com/blog/sitemap-202610.xml" : "https://sell.amazon.com/blog/sitemap-202611.xml";
    return xml(`<sitemapindex><sitemap><loc>${child}</loc></sitemap></sitemapindex>`, url);
  }), /depth limit/);

  const entries = Array.from({ length: 501 }, (_, i) => `<url><loc>https://sell.amazon.com/blog/post-${i}</loc></url>`).join("");
  await assert.rejects(fromAmazonBlogSitemap(source as never, async (url) => xml(`<urlset>${entries}</urlset>`, url)), /article URL limit/);

  await assert.rejects(fromAmazonBlogSitemap(source as never, async (url) => xml(`<urlset>${" ".repeat(2 * 1024 * 1024)}</urlset>`, url)), /oversized/);
});

test("Amazon sitemap caps root plus monthly child requests", async () => {
  const calls: string[] = [];
  const monthly = Array.from({ length: 40 }, (_, i) => {
    const month = String(i + 1).padStart(2, "0");
    return `<sitemap><loc>https://sell.amazon.com/blog/sitemap-2026${month}.xml</loc><lastmod>2026-${month}-01</lastmod></sitemap>`;
  }).join("");
  await fromAmazonBlogSitemap(source as never, async (url) => {
    calls.push(url);
    if (url.endsWith("sitemap.xml")) return xml(`<sitemapindex>${monthly}</sitemapindex>`, url);
    return xml("<urlset></urlset>", url);
  });
  assert.equal(calls.length, 21, "one index and at most twenty child files");
});

test("newer Sitemap lastmod schedules a detail refresh only when it advances", () => {
  const earlier = new Date("2026-10-20T00:00:00Z");
  const later = new Date("2026-10-21T00:00:00Z");
  assert.equal(sitemapLastmodAdvanced(later, earlier), true);
  assert.equal(sitemapLastmodAdvanced(earlier, later), false);
  assert.equal(sitemapLastmodAdvanced(earlier, null), true);
  assert.equal(sitemapLastmodAdvanced(null, earlier), false);
});
