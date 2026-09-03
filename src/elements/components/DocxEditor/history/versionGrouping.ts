// Pure grouping for the History panel. The list endpoint returns versions
// newest-first; this collapses a burst of same-day saves into one row (with the
// older ones tucked behind a chevron) and buckets rows under month headers.
import { DocxVersion } from './types';

// Same-day versions whose ends fall within this window are one cluster.
export const CLUSTER_GAP_MS = 15 * 60 * 1000;

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
  /** Older versions in the cluster, newest-first (revealed on expand). */
  earlier: DocxVersion[];
  /** Distinct authors across the cluster, in first-seen (newest-first) order. */
  authors: Array<{ kind: string; label: string }>;
}

export interface MonthSection {
  key: string; // 'YYYY-M'
  label: string; // 'September 2026'
  clusters: VersionCluster[];
}

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

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

/** Group versions (newest-first) into month sections of 15-minute clusters. */
export function groupVersions(versions: DocxVersion[]): MonthSection[] {
  const sections: MonthSection[] = [];
  let section: MonthSection | null = null;
  let cluster: VersionCluster | null = null;
  let prevEnded: Date | null = null;

  for (const version of versions) {
    const ended = new Date(version.ended_at);
    const monthKey = `${ended.getFullYear()}-${ended.getMonth()}`;

    if (!section || section.key !== monthKey) {
      section = {
        key: monthKey,
        label: `${MONTHS[ended.getMonth()]} ${ended.getFullYear()}`,
        clusters: []
      };
      sections.push(section);
      cluster = null; // a month boundary always breaks the cluster
    }

    const withinGap =
      prevEnded !== null &&
      sameDay(prevEnded, ended) &&
      prevEnded.getTime() - ended.getTime() <= CLUSTER_GAP_MS;

    if (cluster && withinGap) {
      cluster.earlier.push(version);
      mergeAuthors(cluster, version);
    } else {
      cluster = { primary: version, earlier: [], authors: [] };
      mergeAuthors(cluster, version);
      section.clusters.push(cluster);
    }
    prevEnded = ended;
  }

  return sections;
}
