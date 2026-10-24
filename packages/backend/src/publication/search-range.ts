import { addDays, beijingMidnight, isValidDate } from "@aihot/contracts/time";

/** Explicit, bounded publication-date range for historical Agent searches. Dates are Beijing days. */
export interface HistoricalSearchRange {
  from: string;
  to: string;
  start: Date;
  endExclusive: Date;
}

export type HistoricalSearchRangeResult =
  | { range: null }
  | { range: HistoricalSearchRange }
  | { error: string };

const DAY_MS = 86400000;
const MAX_DAYS = 366;

/** Neither date preserves the legacy rolling-window search. A range must be complete and bounded. */
export function parseHistoricalSearchRange(from?: string, to?: string): HistoricalSearchRangeResult {
  if (from === undefined && to === undefined) return { range: null };
  if (from === undefined || to === undefined) return { error: "from and to must be supplied together." };
  if (!isValidDate(from) || !isValidDate(to)) return { error: "from and to must be real YYYY-MM-DD calendar dates." };

  const fromUtc = Date.parse(`${from}T00:00:00Z`);
  const toUtc = Date.parse(`${to}T00:00:00Z`);
  const days = (toUtc - fromUtc) / DAY_MS + 1;
  if (days < 1) return { error: "from must be on or before to." };
  if (days > MAX_DAYS) return { error: `historical search is limited to ${MAX_DAYS} calendar days.` };

  return { range: { from, to, start: beijingMidnight(from), endExclusive: beijingMidnight(addDays(to, 1)) } };
}
