// One highlighted view over the sessions folded under a History row: each
// session's edits are attributed to that session's author.
import {
  applyHunks,
  ChangeList,
  countEditGroups,
  diffSession,
  normalizeForDiff
} from './sfdtDiff/index';
import { DocxVersion } from './types';

export interface FoldedSession {
  finalSfdt: string;
  changes: ChangeList | null;
  author: string;
}

// Highlights the diff adds to a display document; real tracked changes differ.
const SYNTHETIC_REVISION_PREFIX = 'vh-';

/** The author key a whole session's edits are drawn with. Browser sessions
 *  record a person as 'you', so the saved actor names them instead. */
export function sessionAuthorKey(version: DocxVersion): string {
  const authors = version.authors ?? [];
  if (authors.length && authors.every((a) => a.kind === 'assistant'))
    return 'robin';
  return version.actor_label || version.actor_name || 'you';
}

/** A session where a person and Robin both edited. One author per session
 *  would paint Robin's edits in the person's colour, so these aren't combined. */
export function mixesPersonAndRobin(version: DocxVersion): boolean {
  const kinds = new Set((version.authors ?? []).map((a) => a.kind));
  return kinds.has('user') && kinds.has('assistant');
}

/** Robin edit groups the folded sessions confirmed, as each counts on its own. */
export function approvedEditCount(sessions: FoldedSession[]): number {
  return sessions.reduce(
    (total, session) =>
      session.changes?.confirmed
        ? total +
          countEditGroups(
            applyHunks(JSON.parse(session.finalSfdt), session.changes)
          )
        : total,
    0
  );
}

/** The document before a session, rebuilt by rejecting its own highlights;
 *  null without a usable change list. */
export function sessionStart(session: FoldedSession): any | null {
  if (!session.changes?.hunks?.length) return null;
  const display = applyHunks(JSON.parse(session.finalSfdt), session.changes);
  const ids = (display.revisions ?? [])
    .map((revision: any) => String(revision.revisionId ?? ''))
    .filter((id: string) => id.startsWith(SYNTHETIC_REVISION_PREFIX));
  return normalizeForDiff(display, { rejectRevisionIds: ids });
}

/** One change list from `start` through every session, oldest first; null
 *  when the diff runs out of time. */
export function diffFoldedSessions(
  start: unknown,
  sessions: FoldedSession[],
  timeBudgetMs = 4000
): ChangeList | null {
  const changes = diffSession(
    start,
    sessions.map((session) => ({
      sfdt: JSON.parse(session.finalSfdt),
      author: session.author
    })),
    'folded',
    { timeBudgetMs }
  );
  if (changes.degraded?.includes('time-budget')) return null;
  changes.attribution = 'slices';
  // Robin-only sessions keep their accepted text red, as in their own view.
  const robinRuns = sessions.flatMap(
    (session) => session.changes?.robinRuns ?? []
  );
  if (robinRuns.length) changes.robinRuns = robinRuns;
  return changes;
}
