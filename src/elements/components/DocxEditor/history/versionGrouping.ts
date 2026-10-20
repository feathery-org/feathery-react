// Buckets newest-first versions under Today/month headers and folds bursts of
// sessions (each within 15 minutes of the next) into one expandable row.
import { DocxVersion } from './types';

// Max idle gap between a session's end and the next session's start to fold.
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

export type ClusterAuthor = { kind: string; label: string; key?: string };

export interface VersionCluster {
  /** Newest version in the cluster (the visible row). */
  primary: DocxVersion;
  /** Older versions folded under the row, newest-first (shown on expand). */
  earlier: DocxVersion[];
  /** Distinct authors across the cluster, in first-seen (newest-first) order. */
  authors: ClusterAuthor[];
}

export interface MonthSection {
  key: string; // 'YYYY-M'
  label: string; // 'September 2026'
  clusters: VersionCluster[];
}

// Browser sessions store every person as "You"; the saved actor says whose
// session it was, so resolve before merging sessions from different people.
export const resolveAuthors = (
  version: DocxVersion,
  authors: ClusterAuthor[] = version.authors ?? []
): ClusterAuthor[] =>
  authors.map((author) =>
    author.kind === 'user' &&
    (!author.label || author.label === 'You') &&
    (version.actor_name || version.actor_label)
      ? {
          kind: author.kind,
          label: version.actor_name || version.actor_label,
          key: version.actor_label || version.actor_name
        }
      : { kind: author.kind, label: author.label, key: author.key }
  );

const authorId = (author: ClusterAuthor) =>
  `${author.kind}\u0000${author.label}`;

/** Distinct authors across the lists, in first-seen order. */
export const mergeAuthorLists = (lists: ClusterAuthor[][]): ClusterAuthor[] => {
  const merged = new Map<string, ClusterAuthor>();
  for (const author of lists.flat()) {
    if (!merged.has(authorId(author))) merged.set(authorId(author), author);
  }
  return Array.from(merged.values());
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

// Current, named, restored and baseline versions keep their own visible row:
// they may head a cluster but are never folded under another one.
const keepsOwnRow = (version: DocxVersion, currentSeq: number): boolean =>
  version.is_current ||
  version.seq === currentSeq ||
  Boolean(version.name) ||
  Boolean(version.restored_from_at || version.restored_from) ||
  version.is_baseline;

/** Group versions (newest-first) into Today + month sections of 15-minute
 *  clusters. `now` is injectable for tests. */
export function groupVersions(
  versions: DocxVersion[],
  now: Date = new Date()
): MonthSection[] {
  const sections: MonthSection[] = [];
  const currentSeq = versions.reduce((max, v) => Math.max(max, v.seq), -1);
  let section: MonthSection | null = null;
  let cluster: VersionCluster | null = null;
  let newer: DocxVersion | null = null;

  for (const version of versions) {
    const ended = new Date(version.ended_at);
    const { key, label } = sectionFor(ended, now);

    if (!section || section.key !== key) {
      section = { key, label, clusters: [] };
      sections.push(section);
      cluster = null; // clusters never cross a section boundary
    }

    // Chained: compare with the next-newer version, and only on the same day.
    const withinGap =
      newer !== null &&
      isSameDay(new Date(newer.ended_at), ended) &&
      new Date(newer.started_at || newer.ended_at).getTime() -
        ended.getTime() <=
        CLUSTER_GAP_MS;

    if (cluster && withinGap && !keepsOwnRow(version, currentSeq)) {
      cluster.earlier.push(version);
    } else {
      cluster = { primary: version, earlier: [], authors: [] };
      section.clusters.push(cluster);
    }
    cluster.authors = mergeAuthorLists([
      cluster.authors,
      resolveAuthors(version)
    ]);
    newer = version;
  }

  return sections;
}

/** The versions folded under `versionId`'s row and the version just before
 *  them, or null when that row folds nothing. */
export function foldedUnder(
  versions: DocxVersion[],
  versionId: string,
  now: Date = new Date()
): { earlier: DocxVersion[]; preceding: DocxVersion | null } | null {
  for (const section of groupVersions(versions, now)) {
    const cluster = section.clusters.find((c) => c.primary.id === versionId);
    if (!cluster) continue;
    if (!cluster.earlier.length) return null;
    const oldest = Math.min(...cluster.earlier.map((v) => v.seq));
    const preceding = versions
      .filter((v) => v.seq < oldest)
      .reduce<DocxVersion | null>(
        (best, v) => (!best || v.seq > best.seq ? v : best),
        null
      );
    return { earlier: cluster.earlier, preceding };
  }
  return null;
}
