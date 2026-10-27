import { Link } from "react-router";
import { IconSearch } from "../../components/icons";

export interface FilterTheme {
  id: string;
  label: string;
}

export interface FilterSource {
  id: string;
  name: string;
}

export function IntelligenceFilters({
  actionUrl,
  themes = [],
  activeTheme = null,
  themeParam = "theme",
  sources = [],
  activeSource = "",
  dateBasis,
  from,
  to,
  q = "",
  searchPlaceholder = "搜索关键词…",
  exportMarkdownUrl,
  exportJsonUrl,
  secondaryLinks = [],
  extraFilters,
}: {
  actionUrl: string;
  themes?: FilterTheme[];
  activeTheme?: string | null;
  themeParam?: string;
  sources?: FilterSource[];
  activeSource?: string;
  dateBasis?: string;
  from?: string | null;
  to?: string | null;
  q?: string;
  searchPlaceholder?: string;
  exportMarkdownUrl?: string;
  exportJsonUrl?: string;
  secondaryLinks?: Array<{ label: string; to: string; active?: boolean }>;
  extraFilters?: React.ReactNode;
}) {
  const hasDateFilter = !!(from || to);

  const themeLink = (themeId: string | null) => {
    const sp = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    sp.delete("page");
    if (themeId) sp.set(themeParam, themeId);
    else sp.delete(themeParam);
    const qs = sp.toString();
    return qs ? `${actionUrl}?${qs}` : actionUrl;
  };

  return (
    <div className="space-y-3">
      {/* Theme Pills */}
      {themes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="主题分类">
          <Link
            to={themeLink(null)}
            className={`chip ${!activeTheme ? "ring-accent text-accent font-medium" : ""}`}
          >
            全部主题
          </Link>
          {themes.map((t) => (
            <Link
              key={t.id}
              to={themeLink(t.id)}
              className={`chip ${activeTheme === t.id ? "ring-accent text-accent font-medium" : ""}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      )}

      {/* Main Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-card border border-line bg-surface px-3 py-2.5">
        <form method="get" action={actionUrl} className="flex flex-wrap items-end gap-2 text-[12px]">
          {activeTheme && <input type="hidden" name={themeParam} value={activeTheme} />}

          {/* Search Box */}
          <div className="relative">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={searchPlaceholder}
              aria-label="关键词搜索"
              className="h-8 min-w-44 rounded-control border border-line bg-bg pl-7 pr-2 text-[12px] text-ink placeholder:text-ink-4"
            />
            <IconSearch size={14} className="absolute left-2 top-2.5 text-ink-4" />
          </div>

          {/* Source dropdown */}
          {sources.length > 0 && (
            <label className="text-[11px] text-ink-4">
              来源
              <select
                aria-label="来源筛选"
                name="source"
                defaultValue={activeSource}
                className="mt-0.5 block h-8 max-w-[200px] rounded-control border border-line bg-bg px-2 text-[12px] text-ink"
              >
                <option value="">全部来源</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Extra filters (e.g. state or polarity) */}
          {extraFilters}

          {/* Date range */}
          <label className="text-[11px] text-ink-4">
            起始日期
            <input
              type="date"
              name="from"
              defaultValue={from ?? ""}
              aria-label="起始日期"
              className="mt-0.5 block h-8 rounded-control border border-line bg-bg px-2 text-[12px] text-ink"
            />
          </label>
          <label className="text-[11px] text-ink-4">
            截至日期
            <input
              type="date"
              name="to"
              defaultValue={to ?? ""}
              aria-label="截至日期"
              className="mt-0.5 block h-8 rounded-control border border-line bg-bg px-2 text-[12px] text-ink"
            />
          </label>

          <button
            type="submit"
            className="h-8 rounded-control bg-ink px-3 text-[12px] font-medium text-bg hover:opacity-90"
          >
            筛选
          </button>

          {(hasDateFilter || activeSource || q) && (
            <Link
              to={actionUrl}
              className="inline-flex h-8 items-center px-2 text-[12px] text-ink-3 hover:text-ink"
            >
              重置
            </Link>
          )}
        </form>

        {/* Secondary Links & Export Buttons */}
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          {secondaryLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`inline-flex min-h-8 items-center rounded-full px-3 text-[12px] font-medium transition-colors ${
                link.active
                  ? "bg-ink text-bg"
                  : "bg-well text-ink-2 hover:bg-bg-sunk"
              }`}
            >
              {link.label}
            </Link>
          ))}
          {exportMarkdownUrl && (
            <a
              href={exportMarkdownUrl}
              download
              className="inline-flex min-h-8 items-center rounded-full border border-line px-3 text-[12px] font-medium text-ink-2 hover:bg-bg-sunk"
            >
              导出 Markdown
            </a>
          )}
          {exportJsonUrl && (
            <a
              href={exportJsonUrl}
              download
              className="inline-flex min-h-8 items-center rounded-full border border-line px-3 text-[12px] font-medium text-ink-2 hover:bg-bg-sunk"
            >
              导出 JSON
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
