// Pure history computation shared by the worker and unsupported-browser fallback.
import {
  applyHunks,
  collectRobinRuns,
  contentHash,
  countEditGroups,
  countPendingGroups,
  diffSession,
  normalizeForDiff,
  trackedAuthorKeys,
  demoteNativeRowRevisions
} from './sfdtDiff';
import type { ChangeList, RevisionRun, Slice } from './sfdtDiff';
import { parseChangeList } from './validation';
import { populateVersionBindings } from './populateVersionBindings';
import type { VersionAuthor } from './types';
import type {
  SessionPreview,
  TrackedChangeAcceptance
} from './useDocxHistorySession';
import type { VersionDocument } from './useVersionDocument';
type ResolvedVersion = Omit<VersionDocument, 'loading'>;
const ROBIN: VersionAuthor = {
  kind: 'assistant',
  key: 'robin',
  label: 'Robin'
};
export interface HistorySnapshot {
  fStr: string | null;
  fAuthor: string;
  s0: string | null;
  slices: Slice[];
  slicesComplete: boolean;
  robinRuns: RevisionRun[];
  acceptance: TrackedChangeAcceptance | null;
}
export interface HistoryTasks {
  storedFiles: {
    input: {
      finalBuffer: ArrayBuffer;
      changesBuffer: ArrayBuffer | null;
      expectedSha256: string | null;
    };
    result: ResolvedVersion;
  };
  close: {
    input: { sessionId: string; snapshot: HistorySnapshot };
    result: { finalSha256: string; startSha256: string; changes?: ChangeList };
  };
  preview: {
    input: {
      sessionId: string;
      snapshot: HistorySnapshot;
      currentUser: VersionAuthor;
    };
    result: SessionPreview | null;
  };
  stored: {
    input: {
      finalSfdt: string;
      changes: ChangeList | null;
      expectedSha256: string | null;
    };
    result: ResolvedVersion;
  };
}
function uniqueRevisionRuns(runs: RevisionRun[]): RevisionRun[] {
  const seen = new Set<string>();
  return runs.filter((run) => {
    const key = JSON.stringify([run.kind, run.text, run.group ?? null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function closeHistory(
  sessionId: string,
  snap: HistorySnapshot
): HistoryTasks['close']['result'] {
  if (!snap.fStr) throw new Error('Missing final history snapshot');
  const fStr = snap.fStr;
  const fDoc = JSON.parse(fStr);
  const finalSha256 = contentHash(normalizeForDiff(fDoc));
  const confirmedStart = snap.acceptance
    ? normalizeForDiff(JSON.parse(snap.acceptance.beforeSfdt), {
        rejectRevisionIds: snap.acceptance.revisionIds
      })
    : null;
  const startSha256 = confirmedStart
    ? contentHash(confirmedStart)
    : snap.s0
    ? contentHash(normalizeForDiff(JSON.parse(snap.s0)))
    : '';

  // Diff the session into per-author hunks. The stored slices are the
  // author-boundary snapshots; F is the closing state. A tab-death session
  // (no S0) or a diff failure degrades to docx-only (no highlights).
  let resultChanges: ChangeList | undefined;
  try {
    if (snap.s0) {
      // Missing author boundaries cannot produce trustworthy attribution.
      if (!snap.slicesComplete) throw new Error('History slice limit reached');
      const diffSlices = snap.acceptance
        ? [{ sfdt: fDoc, author: ROBIN.key }]
        : [
            ...snap.slices.map((s) => ({
              sfdt: JSON.parse(s.sfdt as string),
              author: s.author,
              endedAt: s.endedAt
            })),
            { sfdt: fDoc, author: snap.fAuthor }
          ];
      const changes = diffSession(
        confirmedStart ?? JSON.parse(snap.s0),
        diffSlices,
        sessionId,
        {
          timeBudgetMs: 4000
        }
      );
      if (changes.degraded?.includes('time-budget'))
        throw new Error('History diff timed out');
      changes.attribution = 'slices';
      if (snap.acceptance) changes.confirmed = true;
      // Kept well under the backend's 512KB limit; over budget, all runs
      // are dropped rather than risk the upload being rejected.
      const ROBIN_RUNS_BUDGET = 100_000;
      // On accept the pending-edit version already closed (runs reset), so
      // recover Robin's groups from the acceptance snapshot.
      const acceptanceRuns = snap.acceptance
        ? collectRobinRuns(
            JSON.parse(snap.acceptance.beforeSfdt),
            snap.acceptance.revisionIds
          )
        : [];
      const robinRuns = uniqueRevisionRuns([
        ...snap.robinRuns,
        ...acceptanceRuns
      ]);
      if (robinRuns.length) {
        const capped: RevisionRun[] = [];
        let used = 0;
        for (const r of robinRuns) {
          used += r.text.length;
          if (used > ROBIN_RUNS_BUDGET) break;
          capped.push(r);
        }
        if (capped.length === robinRuns.length && capped.length)
          changes.robinRuns = capped;
      }
      // Session activity includes accepts and edits that were later undone.
      // Persist only authors whose final revisions the viewer can render.
      const display = applyHunks(fDoc, changes);
      changes.trackedAuthors = trackedAuthorKeys(display);
      resultChanges = changes;
    }
  } catch {
    // Diff failed (unexpected SFDT shape, over budget): upload F alone so
    // the version still opens, with the one-colour fallback at view time.
    resultChanges = undefined;
  }

  return { finalSha256, startSha256, changes: resultChanges };
}
function previewHistory(
  sessionId: string,
  snap: HistorySnapshot,
  currentUser: VersionAuthor
): SessionPreview | null {
  if (!snap.fStr || !snap.s0 || !snap.slicesComplete) return null;
  try {
    const fDoc = JSON.parse(snap.fStr);
    const diffSlices = [
      ...snap.slices.map((s) => ({
        sfdt: JSON.parse(s.sfdt as string),
        author: s.author,
        endedAt: s.endedAt
      })),
      { sfdt: fDoc, author: snap.fAuthor }
    ];
    const startDoc = JSON.parse(snap.s0);
    // The backend removes net-zero versions. Do not display intermediate
    // author-boundary edits after the document has been fully undone.
    const unchanged =
      contentHash(normalizeForDiff(startDoc)) ===
      contentHash(normalizeForDiff(fDoc));
    const changes = diffSession(
      startDoc,
      unchanged ? [{ sfdt: fDoc, author: snap.fAuthor }] : diffSlices,
      sessionId,
      { timeBudgetMs: 4000 }
    );
    changes.attribution = 'slices';
    if (changes.degraded?.includes('time-budget')) return null;
    // As in closeSession: keeps Robin edits accepted this session coloured
    // as Robin in the live preview.
    if (snap.robinRuns.length) changes.robinRuns = snap.robinRuns;
    const display = applyHunks(fDoc, changes);
    return {
      sessionId,
      authors: trackedAuthorKeys(display).map((key) =>
        key === ROBIN.key ? ROBIN : { ...currentUser, key }
      ),
      artifacts: { finalSfdt: JSON.stringify(fDoc), changes },
      sfdt: JSON.stringify(display),
      // Same grouping as the steppers: a Robin turn counts as one edit.
      editCount: countEditGroups(display, { includeFormatting: true }),
      formatCount: changes.formatChangeCount,
      pendingCount: countPendingGroups(display)
    };
  } catch {
    return null;
  }
}
export function buildFromFinal(
  finalSfdt: string,
  changes: ChangeList | null,
  expectedSha256: string | null
): ResolvedVersion {
  const finalDoc = JSON.parse(finalSfdt);
  if (finalDoc.optimizeSfdt && Array.isArray(finalDoc.sec))
    return {
      error: false,
      sfdt: finalSfdt,
      degraded: true,
      needsBindingPopulation: true
    };

  const plainSfdt = () => {
    try {
      // Native tracked-row marks flood whole table rows in the viewer; move
      // them onto cell content so a plain view paints like a regular version.
      const demoted = demoteNativeRowRevisions(finalDoc);
      const populated = populateVersionBindings(finalDoc);
      if (populated !== finalDoc) return JSON.stringify(populated);
      return demoted ? JSON.stringify(finalDoc) : finalSfdt;
    } catch {
      return finalSfdt;
    }
  };

  if (changes) {
    try {
      if (
        changes.degraded?.includes('time-budget') ||
        (changes.final_sha256 &&
          (changes.final_sha256 !== contentHash(normalizeForDiff(finalDoc)) ||
            (expectedSha256 && changes.final_sha256 !== expectedSha256)))
      )
        return { error: false, sfdt: plainSfdt(), degraded: true };
      if (!changes.hunks?.length)
        return { error: false, sfdt: plainSfdt(), degraded: true };
      const display = applyHunks(finalDoc, changes);
      let displaySfdt: string;
      try {
        displaySfdt = JSON.stringify(populateVersionBindings(display));
      } catch {
        displaySfdt = JSON.stringify(display);
      }
      return {
        error: false,
        sfdt: displaySfdt,
        editCount: countEditGroups(display, { includeFormatting: true }),
        formatCount: changes.formatChangeCount,
        pendingCount: countPendingGroups(display),
        approvedCount: changes.confirmed ? countEditGroups(display) : 0,
        degraded: false
      };
    } catch {
      return { error: false, sfdt: plainSfdt(), degraded: true };
    }
  }
  return { error: false, sfdt: plainSfdt(), degraded: true };
}

export function computeHistoryTask<K extends keyof HistoryTasks>(
  type: K,
  input: HistoryTasks[K]['input']
): HistoryTasks[K]['result'] {
  switch (type) {
    case 'close': {
      const args = input as HistoryTasks['close']['input'];
      return closeHistory(args.sessionId, args.snapshot);
    }
    case 'preview': {
      const args = input as HistoryTasks['preview']['input'];
      return previewHistory(args.sessionId, args.snapshot, args.currentUser);
    }
    case 'stored': {
      const args = input as HistoryTasks['stored']['input'];
      return buildFromFinal(args.finalSfdt, args.changes, args.expectedSha256);
    }
    default:
      throw new Error('Unknown history task');
  }
}

async function decodeFile(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
    return new TextDecoder().decode(bytes);
  const DS = (globalThis as any).DecompressionStream;
  if (!DS) throw new Error('gzip decompression unavailable');
  return new Response(
    new Blob([bytes]).stream().pipeThrough(new DS('gzip'))
  ).text();
}

export async function executeHistoryTask<K extends keyof HistoryTasks>(
  type: K,
  input: HistoryTasks[K]['input']
): Promise<HistoryTasks[K]['result']> {
  if (type !== 'storedFiles') return computeHistoryTask(type, input);
  const args = input as HistoryTasks['storedFiles']['input'];
  const [finalSfdt, changesText] = await Promise.all([
    decodeFile(args.finalBuffer),
    args.changesBuffer ? decodeFile(args.changesBuffer).catch(() => null) : null
  ]);
  let changes: ChangeList | null = null;
  try {
    if (changesText) changes = parseChangeList(JSON.parse(changesText));
  } catch {
    /* Plain fallback remains retryable. */
  }
  return buildFromFinal(
    finalSfdt,
    changes,
    args.expectedSha256
  ) as HistoryTasks[K]['result'];
}
