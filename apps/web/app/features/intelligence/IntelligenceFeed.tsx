import { useMemo } from "react";
import type { IntelligenceItem } from "./types";
import { IntelligenceCard } from "./IntelligenceCard";
import { IntelligenceEmptyState } from "./IntelligenceEmptyState";
import { DayHeader } from "../feed/Timeline";
import { Pagination } from "../feed/DayList";
import { beijingDate } from "@aihot/contracts/time";
import { byBeijingDay } from "../../lib/format";

export function IntelligenceFeed({
  items,
  showLane = false,
  emptyTitle,
  emptyMessage,
  emptyAction,
  page,
  pageCount,
  onPageHref,
  headerAside,
}: {
  items: IntelligenceItem[];
  showLane?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: { label: string; to?: string; onClick?: () => void };
  page?: number;
  pageCount?: number;
  onPageHref?: (p: number) => string;
  headerAside?: React.ReactNode;
}) {
  const today = beijingDate(Date.now());
  const days = useMemo(() => {
    return byBeijingDay(items, (it) => it.time || new Date().toISOString());
  }, [items]);

  if (items.length === 0) {
    return (
      <IntelligenceEmptyState
        title={emptyTitle}
        message={emptyMessage}
        action={emptyAction}
      />
    );
  }

  return (
    <div className="space-y-6">
      {days.map(({ day, entries }, i) => (
        <section key={`${day}-${i}`} aria-label={day} className="space-y-3">
          <DayHeader
            day={day}
            today={today}
            count={entries.length}
            aside={i === 0 ? headerAside : undefined}
          />
          <div className="space-y-3">
            {entries.map((item) => (
              <IntelligenceCard
                key={item.id}
                item={item}
                showLane={showLane}
              />
            ))}
          </div>
        </section>
      ))}

      {page && pageCount && pageCount > 1 && onPageHref && (
        <Pagination page={page} pageCount={pageCount} href={onPageHref} />
      )}
    </div>
  );
}
