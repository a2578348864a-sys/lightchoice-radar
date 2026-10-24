/** A canonical YYYY-MM-DD source value means the source supplied a date, not a time. */
export function dateOnlyPublicationDate(publicationTime: string | null | undefined): string | undefined {
  if (!publicationTime || !/^\d{4}-\d{2}-\d{2}$/.test(publicationTime)) return undefined;
  const date = new Date(`${publicationTime}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === publicationTime ? publicationTime : undefined;
}
