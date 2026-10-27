import { useState } from "react";
import { Link } from "react-router";
import type { IntelligenceItem } from "./types";
import { Badge } from "../../components/ui/Badge";
import { IconBookmark, IconExternal } from "../../components/icons";
import { toggleStar, useIsStarred } from "../../lib/local-state";
import { monthDayTime } from "../../lib/format";

export function IntelligenceStarButton({ item, size, className = "size-[26px]" }: { item: IntelligenceItem; size?: number; className?: string }) {
  const on = useIsStarred(item.id);
  const [pulse, setPulse] = useState(0);
  const toggle = () => {
    const added = toggleStar({
      id: item.id,
      title: item.title,
      summary: item.summary ?? null,
      sourceName: item.sourceName,
      publishedAt: item.time,
      score: item.score ?? null,
      aiSelected: false,
    });
    if (added) setPulse((p) => p + 1);
  };

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "取消收藏" : "收藏"}
      title={on ? "取消收藏" : "收藏"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      style={size ? { width: size, height: size } : undefined}
      className={`relative z-10 inline-flex shrink-0 items-center justify-center rounded-control transition-colors duration-150 ${on ? "text-accent" : "text-ink-4 hover:bg-bg-sunk hover:text-ink-2"} ${className}`}
    >
      <span key={pulse} className={`flex ${pulse ? "anim-bump" : ""}`}>
        <IconBookmark size={size ? Math.round(size * 0.6) : 16} filled={on} />
      </span>
    </button>
  );
}

export function IntelligenceCard({
  item,
  showLane = false,
  showTags = true,
}: {
  item: IntelligenceItem;
  showLane?: boolean;
  showTags?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const timeFormatted = item.time ? monthDayTime(item.time) : "时间未确认";

  return (
    <article
      className="relative min-w-0 rounded-card border border-line bg-surface p-4 transition-shadow lg:card lg:card-hover lg:px-[18px] lg:pb-[14px] lg:pt-[15px]"
      data-intelligence-id={item.id}
      data-lane={item.lane}
    >
      {/* Header */}
      <header className="flex min-h-[22px] flex-wrap items-center gap-1.5 text-[12.5px] leading-[18px] text-ink-4 lg:min-h-[18px] lg:gap-2">
        {showLane && (
          <Badge tone="neutral">{item.laneLabel}</Badge>
        )}
        {item.sourceType && (
          <Badge tone={item.sourceTypeTone ?? "ok"}>{item.sourceType}</Badge>
        )}
        {item.statusBadge && (
          <Badge tone={item.statusBadge.tone}>{item.statusBadge.label}</Badge>
        )}
        <span className="font-medium text-ink-3 truncate max-w-[120px] sm:max-w-[200px]" title={item.sourceName}>
          {item.sourceName}
        </span>
        <span className="text-ink-4">·</span>
        <time dateTime={item.time} className="mono text-[12px] text-ink-4 shrink-0">
          {item.timeLabel ? `${item.timeLabel} ` : ""}{timeFormatted}
        </time>
        {item.isTest && (
          <span className="rounded bg-amber-soft px-1 text-[11px] font-semibold text-amber-ink">测试/演示样本</span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-1 pl-1">
          {item.starrable !== false && (
            <IntelligenceStarButton item={item} />
          )}
        </span>
      </header>

      {/* Title */}
      <h3 className="mt-2 text-[17px] font-[650] leading-[1.5] text-ink lg:mt-2.5 lg:leading-[1.55]">
        {item.detailUrl ? (
          <Link to={item.detailUrl} className="transition-colors hover:text-accent">
            {item.title}
          </Link>
        ) : item.externalUrl ? (
          <a href={item.externalUrl} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-accent">
            {item.title}
          </a>
        ) : (
          <span>{item.title}</span>
        )}
      </h3>

      {/* Original title if machine translated */}
      {item.originalTitle && item.originalTitle !== item.title && (
        <p className="mt-1 line-clamp-1 text-[12.5px] leading-[1.6] text-ink-4">
          原文标题：{item.originalTitle}
        </p>
      )}

      {/* Summary */}
      {item.summary && (
        <p className="mt-1.5 text-[14.5px] leading-[1.7] text-ink-3 lg:mt-2 lg:text-[15px] lg:leading-[1.75]">
          {item.summary}
        </p>
      )}

      {/* Context snippet (e.g. for VOC discussion threads or Market comparisons) */}
      {item.contextSnippet && (
        <div className="mt-2 rounded-control bg-well/60 p-2.5 text-[12.5px] leading-relaxed text-ink-3 border border-line-soft">
          <div className="flex items-center justify-between pb-1 text-[11.5px] font-medium text-ink-4">
            <span>原始讨论 / 观测上下文</span>
            {item.contextSnippet.length > 180 && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="text-accent hover:underline text-[11.5px]"
              >
                {expanded ? "收起" : "展开全文"}
              </button>
            )}
          </div>
          <p className={expanded ? "whitespace-pre-wrap" : "line-clamp-3 whitespace-pre-wrap"}>
            {item.contextSnippet}
          </p>
        </div>
      )}

      {/* Identity & Evidence Lines */}
      {(item.identityLine || item.evidenceLine) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-4">
          {item.identityLine && <span>{item.identityLine}</span>}
          {item.evidenceLine && (
            <span className="mono rounded-mark bg-well px-1.5 py-0.5 text-[11px] text-ink-3 border border-line-soft">
              {item.evidenceLine}
            </span>
          )}
        </div>
      )}

      {/* Limitations warning */}
      {item.limitations && (
        <p className="mt-1.5 text-[11.5px] leading-normal text-note">
          ⚠ {item.limitations}
        </p>
      )}

      {/* Tags and footer links */}
      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft/80 pt-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {showTags && item.tags && item.tags.length > 0 && item.tags.map((tag) => (
            <span key={tag} className="chip text-[11.5px]">
              #{tag}
            </span>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3 text-[12px]">
          {item.detailUrl && (
            <Link to={item.detailUrl} className="font-medium text-ink-3 hover:text-accent">
              查看详情 →
            </Link>
          )}
          {item.externalUrl && (
            <a
              href={item.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
            >
              来源原文 <IconExternal size={12} />
            </a>
          )}
        </div>
      </footer>
    </article>
  );
}
