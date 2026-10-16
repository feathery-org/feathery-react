// Resolves a version's display document: final SFDT + change list gets
// highlights; no change list opens plain (degraded); docx-only rows use docx.
import { useEffect, useRef, useState } from 'react';

import { populateVersionBindings } from './populateVersionBindings';
import {
  applyHunks,
  ChangeList,
  countEditGroups,
  countPendingGroups,
  demoteNativeRowRevisions,
  contentHash,
  normalizeForDiff
} from './sfdtDiff/index';
import { DocxHistoryHost, DocxVersion } from './types';
import { parseChangeList } from './validation';
import {
  approvedEditCount,
  diffFoldedSessions,
  FoldedSession,
  mixesPersonAndRobin,
  sessionAuthorKey
} from './foldedSessions';
import { DocxToSfdt } from './convertOriginal';

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

// Older versions are immutable and cached (small LRU); current can still get
// a checkpoint or close at the same id, so it is refetched on refresh.
type ResolvedVersion = Omit<VersionDocument, 'loading'>;
const CACHE_MAX = 8;
const CACHE_BYTES_MAX = 16 * 1024 * 1024;
const versionCache = new Map<string, ResolvedVersion>();
const resolveInFlight = new Map<string, Promise<ResolvedVersion>>();
const hostScopes = new WeakMap<
  DocxHistoryHost,
  { id: number; users: number; epoch: number }
>();
let nextHostId = 0;
const scopeFor = (host: DocxHistoryHost) => {
  let scope = hostScopes.get(host);
  if (!scope) {
    scope = { id: ++nextHostId, users: 0, epoch: 0 };
    hostScopes.set(host, scope);
  }
  return scope;
};

/** Own cache lifetime at the editing surface, not at each preview selection. */
export function retainVersionDocuments(host: DocxHistoryHost): () => void {
  const scope = scopeFor(host);
  scope.users++;
  return () => {
    if (--scope.users > 0) return;
    scope.epoch++;
    for (const key of versionCache.keys())
      if (key.startsWith(`${scope.id}:`)) versionCache.delete(key);
    for (const key of resolveInFlight.keys())
      if (key.startsWith(`${scope.id}:`)) resolveInFlight.delete(key);
    for (const key of convertedStarts.keys())
      if (key.startsWith(`${scope.id}:`)) convertedStarts.delete(key);
  };
}

export function versionDocumentKey(version: DocxVersion): string {
  // A closed row should never change, but including the artifact URLs prevents
  // an accidental id reuse or refreshed serializer payload from serving bytes
  // for a different immutable object.
  return [
    version.id,
    version.session_id,
    version.ended_at,
    version.closed_at,
    version.is_current,
    version.final_sha256,
    version.change_count,
    version.format_change_count,
    (version.final_sfdt ?? '').split('?')[0],
    (version.changes ?? '').split('?')[0],
    (version.editor_file ?? '').split('?')[0],
    (version.file ?? '').split('?')[0]
  ].join('|');
}

const cacheKey = (host: DocxHistoryHost, version: DocxVersion) =>
  `${scopeFor(host).id}:${versionDocumentKey(version)}`;

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
  versionCache.delete(key);
  versionCache.set(key, value);
  const bytes = () =>
    [...versionCache.values()].reduce(
      (total, entry) => total + (entry.sfdt?.length ?? 0) * 2,
      0
    );
  while (versionCache.size > CACHE_MAX || bytes() > CACHE_BYTES_MAX) {
    const oldest = versionCache.keys().next().value as string | undefined;
    if (oldest !== undefined) versionCache.delete(oldest);
  }
}

/** Test-only: drop the module-level cache so cases don't bleed into each other. */
export function __clearVersionDocumentCache(): void {
  versionCache.clear();
  resolveInFlight.clear();
  localArtifacts.clear();
  convertedStarts.clear();
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
  const bytes = () =>
    [...localArtifacts.values()].reduce(
      (total, entry) =>
        total +
        entry.finalSfdt.length * 2 +
        (entry.changes ? JSON.stringify(entry.changes).length * 2 : 0),
      0
    );
  while (
    localArtifacts.size > LOCAL_ARTIFACTS_MAX ||
    bytes() > CACHE_BYTES_MAX
  ) {
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
  // A previous checkpoint can already have URLs. The locally registered close
  // is newer until its matching upload clears it, even when those URLs exist.
  return entry;
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

async function resolveVersionDocument(
  host: DocxHistoryHost,
  version: DocxVersion,
  refreshed = false
): Promise<ResolvedVersion> {
  try {
    if (version.final_sfdt) {
      const finalSfdt = await gunzip(
        await host.fetchVersionFile(version.final_sfdt)
      );
      let changes: ChangeList | null = null;
      if (version.changes && version.change_count != null) {
        try {
          changes = parseChangeList(
            JSON.parse(
              await gunzip(await host.fetchVersionFile(version.changes))
            )
          );
        } catch (error) {
          if (
            !refreshed &&
            host.getVersion &&
            [403, 404].includes((error as any)?.status)
          )
            throw error;
          changes = null;
        }
      }
      return buildFromFinal(finalSfdt, changes, version.final_sha256 ?? null);
    }

    const docxUrl = version.editor_file ?? version.file;
    if (!docxUrl) throw new Error('version has no document');
    return { error: false, docxUrl, degraded: true };
  } catch (error) {
    if (
      !refreshed &&
      host.getVersion &&
      [403, 404].includes((error as any)?.status)
    ) {
      try {
        return await resolveVersionDocument(
          host,
          await host.getVersion(version.id),
          true
        );
      } catch {
        /* one recovery attempt only */
      }
    }
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
  const key = cacheKey(host, version);
  const scope = scopeFor(host);
  const epoch = scope.epoch;
  const cached = cacheGet(key);
  if (cached) return cached;
  const pending = resolveInFlight.get(key);
  if (pending) return pending;
  const resolve = resolveVersionDocument(host, version).then((result) => {
    resolveInFlight.delete(key);
    // A failed diff fetch is retryable. Caching the plain fallback would make
    // one network error hide authors/highlights for the rest of the page visit.
    if (
      scope.epoch === epoch &&
      !result.error &&
      (!result.degraded || !version.changes)
    )
      cacheSet(key, result);
    return result;
  });
  resolveInFlight.set(key, resolve);
  return resolve;
}

/** The sessions folded under a History row, and the version just before them. */
export interface FoldedVersions {
  earlier: DocxVersion[];
  preceding: DocxVersion | null;
}

async function versionArtifacts(
  host: DocxHistoryHost,
  version: DocxVersion
): Promise<Omit<FoldedSession, 'author'> | null> {
  const local = localFor(version);
  if (local)
    return { finalSfdt: local.finalSfdt, changes: local.changes ?? null };
  if (!version.final_sfdt) return null;
  const finalSfdt = await gunzip(
    await host.fetchVersionFile(version.final_sfdt)
  );
  let changes: ChangeList | null = null;
  if (version.changes && version.change_count != null) {
    try {
      changes = parseChangeList(
        JSON.parse(await gunzip(await host.fetchVersionFile(version.changes)))
      );
    } catch {
      changes = null;
    }
  }
  return { finalSfdt, changes };
}

// Docx-only rows (the original upload) converted to SFDT, a few at a time.
const CONVERTED_MAX = 2;
const convertedStarts = new Map<string, Promise<any>>();

/** The document before the folded sessions, or null when it can't be had. */
async function foldedStart(
  host: DocxHistoryHost,
  preceding: DocxVersion | null,
  convertDocx?: DocxToSfdt
): Promise<any | null> {
  if (!preceding) return null;
  const before = await versionArtifacts(host, preceding);
  if (before) return JSON.parse(before.finalSfdt);
  const docxUrl = preceding.editor_file ?? preceding.file;
  if (!docxUrl || !convertDocx) return null;
  const key = cacheKey(host, preceding);
  let pending = convertedStarts.get(key);
  if (!pending) {
    pending = host.fetchVersionFile(docxUrl).then(convertDocx);
    pending.catch(() => convertedStarts.delete(key));
    convertedStarts.set(key, pending);
    while (convertedStarts.size > CONVERTED_MAX) {
      const oldest = convertedStarts.keys().next().value as string | undefined;
      if (oldest !== undefined) convertedStarts.delete(oldest);
    }
  }
  return pending;
}

// A folded row shows every folded session's edits; anything missing falls
// back to the row's own version.
async function resolveFolded(
  host: DocxHistoryHost,
  version: DocxVersion,
  folded: FoldedVersions,
  convertDocx?: DocxToSfdt
): Promise<ResolvedVersion> {
  try {
    const members = [...folded.earlier, version].sort((a, b) => a.seq - b.seq);
    if (members.some(mixesPersonAndRobin))
      return await resolveAndCache(host, version);
    const artifacts = await Promise.all(
      members.map((member) => versionArtifacts(host, member))
    );
    if (artifacts.every(Boolean)) {
      const sessions = artifacts.map((artifact, index) => ({
        ...(artifact as Omit<FoldedSession, 'author'>),
        author: sessionAuthorKey(members[index])
      }));
      const start = await foldedStart(host, folded.preceding, convertDocx);
      const changes = start && diffFoldedSessions(start, sessions);
      if (changes) {
        const combined = buildFromFinal(
          sessions[sessions.length - 1].finalSfdt,
          changes,
          null
        );
        return { ...combined, approvedCount: approvedEditCount(sessions) };
      }
    }
  } catch {
    // Fall through to the single-version view.
  }
  return resolveAndCache(host, version);
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
  version: DocxVersion | null,
  folded?: FoldedVersions | null,
  convertDocx?: DocxToSfdt
): VersionDocument {
  const [state, setState] = useState<VersionDocument>({
    loading: true,
    error: false,
    degraded: true
  });
  const reqId = useRef(0);
  const latestVersion = useRef(version);
  latestVersion.current = version;
  const latestFolded = useRef(folded);
  latestFolded.current = folded;
  const latestConvert = useRef(convertDocx);
  latestConvert.current = convertDocx;
  const documentKey = version
    ? [version, ...(folded?.earlier ?? [])].map(versionDocumentKey).join(',')
    : '';

  useEffect(() => {
    const version = latestVersion.current;
    const id = ++reqId.current;
    if (!host || !version) {
      setState({ loading: false, error: false, degraded: true });
      return;
    }
    const foldedVersions = latestFolded.current?.earlier.length
      ? latestFolded.current
      : null;
    // Local artifacts outrank a cached resolution: a prefetch may have cached
    // the degraded docx fallback before the close registered its snapshot.
    const cached =
      foldedVersions || version.is_current || localFor(version)
        ? undefined
        : cacheGet(cacheKey(host, version));
    if (cached) {
      setState({ loading: false, ...cached });
      return;
    }
    setState({ loading: true, error: false, degraded: true });

    const done = (next: Omit<VersionDocument, 'loading'>) => {
      if (id !== reqId.current) return;
      // Cache successful resolutions only — an error should be retried later.
      setState({ loading: false, ...next });
    };

    (foldedVersions
      ? resolveFolded(host, version, foldedVersions, latestConvert.current)
      : resolveAndCache(host, version)
    ).then(done);
    return () => {
      reqId.current++;
    };
  }, [host, documentKey]);

  return state;
}
