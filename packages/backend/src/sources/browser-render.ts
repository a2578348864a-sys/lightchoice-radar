/// <reference lib="dom" />
// Browser rendering for sources whose content only exists after JavaScript runs.
//
// Only the sources that ask for it pay the cost: the import is dynamic, so the API, the web app and
// the always-on worker never load Playwright. The browser is the one already installed on this
// machine (Playwright's `channel: "chrome"`); nothing is downloaded and no login is performed.

export class BrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserUnavailableError";
  }
}

export interface RenderedLink {
  text: string;
  href: string;
}

export interface RenderedPage {
  url: string;
  finalUrl: string;
  status: number | null;
  title: string;
  h1: string;
  text: string;
  links: RenderedLink[];
}

const DEFAULT_TIMEOUT_MS = 45_000;
const SETTLE_MS = 1_500;
/** The browser this deployment renders with. A machine without Chrome sets its own channel here. */
const BROWSER_CHANNEL = process.env.RADAR_BROWSER_CHANNEL?.trim() || "chrome";

/**
 * Renders each URL in one browser session and returns the page as a reader sees it. Sequential on
 * purpose: this runs for a handful of policy pages, and parallel tabs on one site are what rate
 * limits are for.
 */
export async function renderPages(urls: readonly string[], options: { timeoutMs?: number; channel?: string } = {}): Promise<RenderedPage[]> {
  if (urls.length === 0) return [];
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let chromium: typeof import("@playwright/test").chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    throw new BrowserUnavailableError("Playwright is not installed in this checkout");
  }

  let browser;
  try {
    browser = await chromium.launch({ channel: options.channel ?? BROWSER_CHANNEL, headless: true });
  } catch (error) {
    throw new BrowserUnavailableError(`No local ${options.channel ?? BROWSER_CHANNEL} to render with: ${String(error).slice(0, 200)}`);
  }

  try {
    const pages: RenderedPage[] = [];
    for (const url of urls) {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, locale: "en-US" });
      try {
        let response = null;
        try {
          response = await page.goto(url, { waitUntil: "networkidle", timeout });
        } catch {
          // A page that keeps polling never reaches networkidle; the DOM is still usable.
          response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
          await page.waitForTimeout(4_000);
        }
        await page.waitForTimeout(SETTLE_MS);
        const seen = await page.evaluate(() => ({
          title: document.title,
          h1: document.querySelector("h1")?.textContent?.trim() ?? "",
          finalUrl: location.href,
          text: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim(),
          links: [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].map((a) => ({ text: (a.textContent ?? "").trim(), href: a.href })),
        }));
        pages.push({ url, finalUrl: seen.finalUrl, status: response?.status() ?? null, title: seen.title, h1: seen.h1, text: seen.text, links: seen.links });
      } finally {
        await page.close();
      }
    }
    return pages;
  } finally {
    await browser.close();
  }
}
