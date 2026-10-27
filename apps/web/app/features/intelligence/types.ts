export type IntelligenceLane = "policy" | "industry" | "voc" | "market" | "leads";

export interface IntelligenceItem {
  id: string;
  lane: IntelligenceLane;
  laneLabel: string;
  title: string;
  summary?: string | null;
  originalTitle?: string | null;
  sourceName: string;
  sourceType?: string | null;
  sourceTypeTone?: "ok" | "amber" | "neutral" | "hot";
  time: string;
  timeLabel?: string;
  tags?: string[];
  statusBadge?: { label: string; tone: "ok" | "amber" | "neutral" | "hot" };
  identityLine?: string | null;
  evidenceLine?: string | null;
  limitations?: string | null;
  externalUrl?: string | null;
  detailUrl?: string | null;
  score?: number | null;
  isTest?: boolean;
  contextSnippet?: string | null;
  starrable?: boolean;
}

export interface IntelligenceFeedFilter {
  lane?: IntelligenceLane;
  theme?: string | null;
  source?: string | null;
  dateBasis?: "published" | "collected";
  from?: string | null;
  to?: string | null;
  q?: string | null;
  status?: string | null;
}
