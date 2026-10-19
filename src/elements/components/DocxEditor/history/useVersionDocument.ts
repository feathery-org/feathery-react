// Resolves a version's display document: final SFDT + change list gets
// highlights; no change list opens plain (degraded); docx-only rows use docx.
import { useEffect, useRef, useState } from 'react';

import { runHistoryTask } from './historyWorkerClient';
import type { ChangeList } from './sfdtDiff/index';
import { DocxHistoryHost, DocxVersion, LiveSessionAuthors } from './types';
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
  /** Downloaded fallback bytes, shared by prefetch and the selected viewer. */
  docxBytes?: ArrayBuffer;
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
  /** Service snapshots use compact keys; populate bindings after native parsing. */
  needsBindingPopulation?: boolean;
}

// Cache resolved snapshots, including Current. The artifact key changes when
// a checkpoint/save replaces its content; live session artifacts take precedence.
type ResolvedVersion = Omit<VersionDocument, 'loading'>;
const CACHE_MAX = 16;
const CACHE_BYTES_MAX = 48 * 1024 * 1024;
let activeKeys = new Set<string>();
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
  const size =
    (value.sfdt?.length ?? 0) * 2 + (value.docxBytes?.byteLength ?? 0);
  if (size > 16 * 1024 * 1024) return;
  versionCache.delete(key);
  versionCache.set(key, value);
  const bytes = () =>
    [...versionCache.values()].reduce(
      (total, entry) =>
        total +
        (entry.sfdt?.length ?? 0) * 2 +
        (entry.docxBytes?.byteLength ?? 0),
      0
    );
  while (versionCache.size > CACHE_MAX || bytes() > CACHE_BYTES_MAX) {
    const oldest =
      [...versionCache.keys()].find((key) => !activeKeys.has(key)) ??
      (versionCache.keys().next().value as string | undefined);
    if (oldest !== undefined) versionCache.delete(oldest);
  }
}

/** Test-only: drop the module-level cache so cases don't bleed into each other. */
export function __clearVersionDocumentCache(): void {
  versionCache.clear();
  activeKeys.clear();
  resolveInFlight.clear();
  localArtifacts.clear();
  convertedStarts.clear();
}

export interface LocalVersionArtifacts {
  finalSfdt: string;
  changes?: ChangeList;
}

/** A live preview keeps its raw snapshot separate from synthetic highlights. */
export interface LiveVersionDocument extends VersionDocument {
  session?: LiveSessionAuthors & LocalVersionArtifacts;
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

async function resolveVersionDocument(
  host: DocxHistoryHost,
  version: DocxVersion,
  refreshed = false,
  options: { background?: boolean; signal?: AbortSignal } = {}
): Promise<ResolvedVersion> {
  try {
    if (version.final_sfdt) {
      const finalPromise = host.fetchVersionFile(version.final_sfdt);
      const changesPromise = (async () => {
        if (!version.changes || version.change_count == null) return null;
        try {
          return await host.fetchVersionFile(version.changes);
        } catch (error) {
          if (
            !refreshed &&
            host.getVersion &&
            [403, 404].includes((error as any)?.status)
          )
            throw error;
          return null;
        }
      })();
      const [finalBuffer, changesBuffer] = await Promise.all([
        finalPromise,
        changesPromise
      ]);
      return await runHistoryTask(
        'storedFiles',
        {
          finalBuffer,
          changesBuffer,
          expectedSha256: version.final_sha256 ?? null
        },
        options
      );
    }

    if (version.is_baseline && host.prepareVersion) {
      // The server converts its immutable bytes and persists the snapshot.
      // Never send the mutable editor contents as Original.
      const prepared = await host.prepareVersion(version.id);
      if (!prepared.final_sfdt)
        throw new Error('Original snapshot is unavailable');
      return await resolveVersionDocument(host, prepared, refreshed, options);
    }

    const docxUrl = version.editor_file ?? version.file;
    if (!docxUrl) throw new Error('version has no document');
    const docxBytes = await host.fetchVersionFile(docxUrl);
    return { error: false, docxUrl, docxBytes, degraded: true };
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
          true,
          options
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
  version: DocxVersion,
  options: { background?: boolean; signal?: AbortSignal } = {}
): Promise<ResolvedVersion> {
  // A close still uploading (or failed) serves from memory, uncached: the row's
  // artifact URLs appear on a later list refresh and take over naturally.
  const local = localFor(version);
  if (local) {
    try {
      return await runHistoryTask('stored', {
        finalSfdt: local.finalSfdt,
        changes: local.changes ?? null,
        expectedSha256: null
      });
    } catch {
      // Malformed local snapshot: fall through to the fetched/docx path.
    }
  }
  const key = cacheKey(host, version);
  const scope = scopeFor(host);
  const epoch = scope.epoch;
  const cached = cacheGet(key);
  if (cached) return cached;
  const pending = resolveInFlight.get(key);
  if (pending) return pending;
  const resolve = resolveVersionDocument(host, version, false, options).then(
    (result) => {
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
    }
  );
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
  convertDocx?: DocxToSfdt,
  liveDoc?: LiveVersionDocument
): Promise<ResolvedVersion> {
  const fallback = () => liveDoc ?? resolveAndCache(host, version);
  const liveSession = liveDoc?.session;
  try {
    const current = liveSession
      ? { ...version, authors: liveSession.authors }
      : version;
    const members = [...folded.earlier, current].sort((a, b) => a.seq - b.seq);
    if (members.some(mixesPersonAndRobin)) return await fallback();
    const artifacts = await Promise.all(
      members.map((member) =>
        member.id === version.id && liveSession
          ? {
              finalSfdt: liveSession.finalSfdt,
              changes: liveSession.changes ?? null
            }
          : versionArtifacts(host, member)
      )
    );
    if (artifacts.every(Boolean)) {
      const sessions = artifacts.map((artifact, index) => ({
        ...(artifact as Omit<FoldedSession, 'author'>),
        author: sessionAuthorKey(members[index])
      }));
      const start = await foldedStart(host, folded.preceding, convertDocx);
      const changes = start && diffFoldedSessions(start, sessions);
      if (changes) {
        const combined = await runHistoryTask('stored', {
          finalSfdt: sessions[sessions.length - 1].finalSfdt,
          changes,
          expectedSha256: null
        });
        return { ...combined, approvedCount: approvedEditCount(sessions) };
      }
    }
  } catch {
    // Fall through to the single-version view.
  }
  return fallback();
}

/** Retain converted previews as data, without keeping their editor alive. */
export function cacheImportedVersion(
  host: DocxHistoryHost,
  version: DocxVersion,
  sfdt: string
): void {
  if ((!version.final_sfdt || !version.changes) && !localFor(version))
    cacheSet(cacheKey(host, version), { error: false, degraded: true, sfdt });
}

/** Prepare recent saved versions plus Original, one background job at a time. */
export async function prefetchVersionDocuments(
  host: DocxHistoryHost | null | undefined,
  versions: DocxVersion[],
  limit = 5,
  signal?: AbortSignal
): Promise<void> {
  if (!host || signal?.aborted) return;
  const saved = [...versions]
    .filter((v) => v.final_sfdt || v.editor_file || v.file)
    .sort((a, b) => b.seq - a.seq);
  const selected = saved.slice(0, limit);
  const original = saved.find((v) => v.is_baseline);
  if (original && !selected.includes(original)) selected.push(original);
  // Reserve the active set while keeping the global budget authoritative.
  activeKeys = new Set(selected.map((v) => cacheKey(host, v)));
  // Original can require a service import; start it before walking the rest.
  const ordered = original
    ? [original, ...selected.filter((v) => v !== original)]
    : selected;
  for (const version of ordered) {
    if (signal?.aborted) return;
    await resolveAndCache(host, version, { background: true });
  }
}

export function useVersionDocument(
  host: DocxHistoryHost | null | undefined,
  version: DocxVersion | null,
  folded?: FoldedVersions | null,
  convertDocx?: DocxToSfdt,
  liveDoc?: LiveVersionDocument
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
    // Never replace a live preview with an older checkpoint, even if the
    // group cannot be resolved or the preview has no reliable diff artifacts.
    if (
      liveDoc &&
      (!foldedVersions ||
        !liveDoc.session ||
        liveDoc.session.sessionId !== version.session_id)
    ) {
      setState(liveDoc);
      return;
    }
    // Local artifacts outrank a cached resolution: a prefetch may have cached
    // the degraded docx fallback before the close registered its snapshot.
    const cached =
      foldedVersions || localFor(version)
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
      ? resolveFolded(
          host,
          version,
          foldedVersions,
          latestConvert.current,
          liveDoc
        )
      : resolveAndCache(host, version)
    ).then(done);
    return () => {
      reqId.current++;
    };
  }, [host, documentKey, liveDoc]);

  return state;
}
