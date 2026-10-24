// Which of the four approved sources this worker may run right now. Kept pure so the worker's
// start/stop rules can be tested without a database, a queue or a process.
import type { SourceRow } from "@aihot/backend/sources/types";
import {
  AMAZON_US_ANNOUNCEMENTS_SOURCE_ID,
  RADAR_LEAD_SOURCE_ID,
  RADAR_REGULATORY_SOURCE_IDS,
  isApprovedRadarLeadSource,
  isApprovedRadarPolicyWebList,
  isApprovedRadarRegulatoryFeed,
  type RadarRegulatorySourceId,
} from "@aihot/backend/sources/radar-policy-source";

export type SkippedSource = { id: string; reason: string };

export type RunnableSources = {
  announcements: { id: typeof AMAZON_US_ANNOUNCEMENTS_SOURCE_ID; intervalMinutes: number } | null;
  regulatory: Array<{ id: RadarRegulatorySourceId; intervalMinutes: number }>;
  /** The third-party lead source: its own queue, its own cadence, never a policy source. */
  leads: { id: typeof RADAR_LEAD_SOURCE_ID; intervalMinutes: number } | null;
  skipped: SkippedSource[];
  /** True when no approved source can run: the worker must exit instead of idling. */
  allUnavailable: boolean;
};

type Verdict = { ok: true } | { ok: false; reason: string };

function verdict(row: SourceRow | null | undefined, approved: (row: SourceRow) => boolean): Verdict {
  if (!row) return { ok: false, reason: "source row missing" };
  if (!row.enabled) return { ok: false, reason: "source disabled" };
  if (!approved(row)) return { ok: false, reason: "config is not on the approved allowlist" };
  return { ok: true };
}

/**
 * A disabled or non-compliant source is skipped with its own reason; the others keep running.
 * The worker registers queues only for the sources returned here, so a skipped source has neither
 * a schedule nor a fetch handler.
 */
export function selectRunnableSources(input: {
  announcements: SourceRow | null | undefined;
  regulatory: Partial<Record<RadarRegulatorySourceId, SourceRow | null | undefined>>;
  leads?: SourceRow | null | undefined;
}): RunnableSources {
  const skipped: SkippedSource[] = [];
  let announcements: RunnableSources["announcements"] = null;
  const regulatory: RunnableSources["regulatory"] = [];
  let leads: RunnableSources["leads"] = null;

  const announcementVerdict = verdict(input.announcements, (row) => row.id === AMAZON_US_ANNOUNCEMENTS_SOURCE_ID && isApprovedRadarPolicyWebList(row));
  if (announcementVerdict.ok && input.announcements) {
    announcements = { id: AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, intervalMinutes: input.announcements.interval_minutes };
  } else if (!announcementVerdict.ok) {
    skipped.push({ id: AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, reason: announcementVerdict.reason });
  }

  for (const id of RADAR_REGULATORY_SOURCE_IDS) {
    const row = input.regulatory[id];
    const check = verdict(row, (source) => isApprovedRadarRegulatoryFeed(source));
    if (check.ok && row) regulatory.push({ id, intervalMinutes: row.interval_minutes });
    else if (!check.ok) skipped.push({ id, reason: check.reason });
  }

  // The lead source is optional: a worker without it still runs the announcements and the
  // regulatory feeds, and says why it left the lead source out.
  if (input.leads !== undefined) {
    const leadVerdict = verdict(input.leads, (row) => row.id === RADAR_LEAD_SOURCE_ID && isApprovedRadarLeadSource(row));
    if (leadVerdict.ok && input.leads) leads = { id: RADAR_LEAD_SOURCE_ID, intervalMinutes: input.leads.interval_minutes };
    else if (!leadVerdict.ok) skipped.push({ id: RADAR_LEAD_SOURCE_ID, reason: leadVerdict.reason });
  }

  return { announcements, regulatory, leads, skipped, allUnavailable: !announcements && regulatory.length === 0 && !leads };
}

/**
 * The lead source on its own. The dedicated lead worker runs no other source family, so it asks this
 * question alone: the same three gates as above (row present, enabled, on the approved allowlist),
 * without the announcement and regulatory verdicts that do not apply to it.
 */
export function selectLeadSource(leads: SourceRow | null | undefined): {
  source: RunnableSources["leads"];
  skipped: SkippedSource | null;
} {
  if (!leads) return { source: null, skipped: { id: RADAR_LEAD_SOURCE_ID, reason: "source row missing" } };
  const check = verdict(leads, (row) => row.id === RADAR_LEAD_SOURCE_ID && isApprovedRadarLeadSource(row));
  if (!check.ok) return { source: null, skipped: { id: RADAR_LEAD_SOURCE_ID, reason: check.reason } };
  return { source: { id: RADAR_LEAD_SOURCE_ID, intervalMinutes: leads.interval_minutes }, skipped: null };
}
