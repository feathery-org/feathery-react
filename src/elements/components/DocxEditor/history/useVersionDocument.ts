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

async function resolveVersionDocument(
  host: DocxHistoryHost,
  version: DocxVersion
): Promise<ResolvedVersion> {
  try {
    if (version.final_sfdt) {
      const finalSfdt = await gunzip(
        await host.fetchVersionFile(version.final_sfdt)
      );
      const finalDoc = JSON.parse(finalSfdt);

      const plainSfdt = () => {
        try {
          const populated = populateVersionBindings(finalDoc);
          return populated === finalDoc ? finalSfdt : JSON.stringify(populated);
        } catch {
          return finalSfdt;
        }
      };

      if (version.changes && version.change_count != null) {
        try {
          const changes: ChangeList = JSON.parse(
            await gunzip(await host.fetchVersionFile(version.changes))
          );
          if (
            changes.final_sha256 &&
            version.final_sha256 &&
            changes.final_sha256 !== version.final_sha256
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
            degraded: false
          };
        } catch {
          return { error: false, sfdt: plainSfdt(), degraded: true };
        }
      }
      return { error: false, sfdt: plainSfdt(), degraded: true };
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
    const cached = version.is_current ? undefined : cacheGet(cacheKey(version));
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
