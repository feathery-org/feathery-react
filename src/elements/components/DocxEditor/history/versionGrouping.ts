// Buckets newest-first versions under Today/month headers, one row each.
// VersionCluster is kept for the row renderer; `earlier` is always empty.
import { DocxVersion } from './types';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

export interface VersionCluster {
  /** Newest version in the cluster (the visible row). */
  primary: DocxVersion;
  /** Always empty: every version gets its own row. */
  earlier: DocxVersion[];
  /** Distinct authors across the cluster, in first-seen (newest-first) order. */
  authors: Array<{ kind: string; label: string }>;
}

export interface MonthSection {
  key: string; // 'YYYY-M'
  label: string; // 'September 2026'
  clusters: VersionCluster[];
}

const mergeAuthors = (into: VersionCluster, version: DocxVersion): void => {
  for (const author of version.authors ?? []) {
    if (
      !into.authors.some(
        (a) => a.kind === author.kind && a.label === author.label
      )
    ) {
      into.authors.push({ kind: author.kind, label: author.label });
    }
  }
};

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// The bucket a version falls into: today gets its own "Today" header; older
// versions bucket by month (bare month name in the current year, month + year
// otherwise), matching the design.
function sectionFor(ended: Date, now: Date): { key: string; label: string } {
  if (isSameDay(ended, now)) return { key: 'today', label: 'Today' };
  const month = MONTHS[ended.getMonth()];
  const label =
    ended.getFullYear() === now.getFullYear()
      ? month
      : `${month} ${ended.getFullYear()}`;
  return { key: `${ended.getFullYear()}-${ended.getMonth()}`, label };
}

/** Group versions (newest-first) into Today + month sections — flat, one row
 *  each. `now` is injectable for tests. */
export function groupVersions(
  versions: DocxVersion[],
  now: Date = new Date()
): MonthSection[] {
  const sections: MonthSection[] = [];
  let section: MonthSection | null = null;

  for (const version of versions) {
    const ended = new Date(version.ended_at);
    const { key, label } = sectionFor(ended, now);

    if (!section || section.key !== key) {
      section = { key, label, clusters: [] };
      sections.push(section);
    }

    // One version per row: its own cluster with no `earlier` entries.
    const cluster: VersionCluster = {
      primary: version,
      earlier: [],
      authors: []
    };
    mergeAuthors(cluster, version);
    section.clusters.push(cluster);
  }

  return sections;
}
