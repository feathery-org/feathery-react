// Resolves the document to show for a selected version. When the version was
// closed with a final SFDT AND a change list, its hunks are applied so the
// viewer renders them as tracked-change highlights; without a change list it
// shows the document plain (degraded — a tab-death row, a >30-day pruned row, or
// a hash mismatch). An old docx-only row falls back to its stored docx.
import { useEffect, useRef, useState } from 'react';

import { populateVersionBindings } from './populateVersionBindings';
import {
  applyHunks,
  ChangeList,
  countEditGroups,
  countPendingGroups
} from './sfdtDiff/index';
import { DocxHistoryHost, DocxVersion } from './types';

export interface VersionDocument {
  loading: boolean;
  error: boolean;
  /** SFDT string to open directly (final SFDT, or the applyHunks display doc). */
  sfdt?: string;
  /** Docx URL to open through the service (no final SFDT — the fallback). */
  docxUrl?: string;
  /** Text-edit count for this version (from its change list). */
  editCount?: number;
  /** Formatting-change count for this version. */
  formatCount?: number;
  /** Assistant edits still tracked (not yet accepted) in this version. */
  pendingCount?: number;
  /** Robin edit groups confirmed by accepting tracked changes in this version. */
  approvedCount?: number;
  /** True when detailed per-author highlights are unavailable (no change list,
   *  pruned highlights, or a hash mismatch) — the document still opens plain. */
  degraded: boolean;
}

// Older versions are immutable, so a resolved document can be cached locally.
// Current can still receive a later checkpoint or close at the same id, and
// must be fetched again when its row is refreshed.
// Bounded to the most-recently-used few so memory stays flat on long sessions.
type ResolvedVersion = Omit<VersionDocument, 'loading'>;
const CACHE_MAX = 8;
const versionCache = new Map<string, ResolvedVersion>();
const resolveInFlight = new Map<string, Promise<ResolvedVersion>>();

function cacheKey(version: DocxVersion): string {
  // A closed row should never change, but including the artifact URLs prevents
  // an accidental id reuse or refreshed serializer payload from serving bytes
  // for a different immutable object.
  return [
    version.id,
    version.final_sfdt ?? '',
    version.changes ?? '',
    version.editor_file ?? '',
    version.file ?? ''
  ].join('|');
}

function cacheGet(key: string): ResolvedVersion | undefined {
  const hit = versionCache.get(key);
  if (hit) {
    // LRU touch: move to the newest slot.
    versionCache.delete(key);
    versionCache.set(key, hit);
  }
  return hit;
}
function cacheSet(key: string, value: ResolvedVersion): void {
  versionCache.set(key, value);
  if (versionCache.size > CACHE_MAX) {
    const oldest = versionCache.keys().next().value as string | undefined;
    if (oldest !== undefined) versionCache.delete(oldest);
  }
}

/** Test-only: drop the module-level cache so cases don't bleed into each other. */
export function __clearVersionDocumentCache(): void {
  versionCache.clear();
  resolveInFlight.clear();
  localArtifacts.clear();
}

export interface LocalVersionArtifacts {
  finalSfdt: string;
  changes?: ChangeList;
}

// The closing session's artifacts, kept in memory while their upload is in
// flight (or failed), so the viewer never degrades to the raw control-bearing
// docx for a row the client can render exactly.
const LOCAL_ARTIFACTS_MAX = 4;
const localArtifacts = new Map<string, LocalVersionArtifacts>();

export function registerLocalVersionArtifacts(
  sessionId: string,
  artifacts: LocalVersionArtifacts
): void {
  localArtifacts.delete(sessionId);
  localArtifacts.set(sessionId, artifacts);
  if (localArtifacts.size > LOCAL_ARTIFACTS_MAX) {
    const oldest = localArtifacts.keys().next().value as string | undefined;
    if (oldest !== undefined) localArtifacts.delete(oldest);
  }
}

/** The registered artifacts for a session, if any (also used by tests). */
export function localVersionArtifactsFor(
  sessionId: string
): LocalVersionArtifacts | undefined {
  return localArtifacts.get(sessionId);
}

/** Drop a session's local artifacts once uploaded. With `finalSfdt`, only the
 *  matching snapshot is cleared — an older checkpoint's upload completing must
 *  not evict a newer close's registration. */
export function clearLocalVersionArtifacts(
  sessionId: string,
  finalSfdt?: string
): void {
  const entry = localArtifacts.get(sessionId);
  if (!entry) return;
  if (finalSfdt !== undefined && entry.finalSfdt !== finalSfdt) return;
  localArtifacts.delete(sessionId);
}

function localFor(version: DocxVersion): LocalVersionArtifacts | undefined {
  if (!version.session_id) return undefined;
  const entry = localArtifacts.get(version.session_id);
  if (!entry) return undefined;
  // Local wins only while the backend row is missing something it has.
  if (!version.final_sfdt || (!version.changes && entry.changes)) return entry;
  return undefined;
}

async function gunzip(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const isGz = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGz) return new TextDecoder().decode(bytes);
  const DS = (globalThis as any).DecompressionStream;
  if (!DS) throw new Error('gzip decompression unavailable');
  const stream = new Blob([bytes]).stream().pipeThrough(new DS('gzip'));
  return new Response(stream).text();
}

/** Build the viewer document from a final SFDT and (optionally) its change
 *  list. `expectedSha256` guards fetched artifacts; local ones pass null. */
function buildFromFinal(
  finalSfdt: string,
  changes: ChangeList | null,
  expectedSha256: string | null
): ResolvedVersion {
  const finalDoc = JSON.parse(finalSfdt);

  const plainSfdt = () => {
    try {
      const populated = populateVersionBindings(finalDoc);
      return populated === finalDoc ? finalSfdt : JSON.stringify(populated);
    } catch {
      return finalSfdt;
    }
  };

  if (changes) {
    try {
      if (
        changes.final_sha256 &&
        expectedSha256 &&
        changes.final_sha256 !== expectedSha256
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
        editCount: countEditGroups(display),
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

async function resolveVersionDocument(
  host: DocxHistoryHost,
  version: DocxVersion
): Promise<ResolvedVersion> {
  try {
    if (version.final_sfdt) {
      const finalSfdt = await gunzip(
        await host.fetchVersionFile(version.final_sfdt)
      );
      let changes: ChangeList | null = null;
      if (version.changes && version.change_count != null) {
        try {
          changes = JSON.parse(
            await gunzip(await host.fetchVersionFile(version.changes))
          );
        } catch {
          changes = null;
        }
      }
      return buildFromFinal(finalSfdt, changes, version.final_sha256 ?? null);
    }

    const docxUrl = version.editor_file ?? version.file;
    if (!docxUrl) throw new Error('version has no document');
    return { error: false, docxUrl, degraded: true };
  } catch {
    return { error: true, degraded: true };
  }
}

async function resolveAndCache(
  host: DocxHistoryHost,
  version: DocxVersion
): Promise<ResolvedVersion> {
  // A close still uploading (or failed) serves from memory, uncached: the row's
  // artifact URLs appear on a later list refresh and take over naturally.
  const local = localFor(version);
  if (local) {
    try {
      return buildFromFinal(local.finalSfdt, local.changes ?? null, null);
    } catch {
      // Malformed local snapshot: fall through to the fetched/docx path.
    }
  }
  if (version.is_current) return resolveVersionDocument(host, version);
  const key = cacheKey(version);
  const cached = cacheGet(key);
  if (cached) return cached;
  const pending = resolveInFlight.get(key);
  if (pending) return pending;
  const resolve = resolveVersionDocument(host, version).then((result) => {
    resolveInFlight.delete(key);
    if (!result.error) cacheSet(key, result);
    return result;
  });
  resolveInFlight.set(key, resolve);
  return resolve;
}

/** Warm a small set of immutable historical versions after the rail opens. */
export function prefetchVersionDocuments(
  host: DocxHistoryHost | null | undefined,
  versions: DocxVersion[],
  limit = CACHE_MAX
): Promise<void> {
  if (!host) return Promise.resolve();
  return Promise.all(
    versions
      .filter((version) => !version.is_current)
      .slice(0, limit)
      .map((version) => resolveAndCache(host, version))
  ).then(() => undefined);
}

export function useVersionDocument(
  host: DocxHistoryHost | null | undefined,
  version: DocxVersion | null
): VersionDocument {
  const [state, setState] = useState<VersionDocument>({
    loading: true,
    error: false,
    degraded: true
  });
  const reqId = useRef(0);

  useEffect(() => {
    if (!host || !version) {
      setState({ loading: false, error: false, degraded: true });
      return;
    }
    // Local artifacts outrank a cached resolution: a prefetch may have cached
    // the degraded docx fallback before the close registered its snapshot.
    const cached =
      version.is_current || localFor(version)
        ? undefined
        : cacheGet(cacheKey(version));
    if (cached) {
      reqId.current++;
      setState({ loading: false, ...cached });
      return;
    }
    const id = ++reqId.current;
    setState({ loading: true, error: false, degraded: true });

    const done = (next: Omit<VersionDocument, 'loading'>) => {
      if (id !== reqId.current) return;
      // Cache successful resolutions only — an error should be retried later.
      setState({ loading: false, ...next });
    };

    resolveAndCache(host, version).then(done);
  }, [host, version]);

  return state;
}
