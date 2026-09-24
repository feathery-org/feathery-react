// Host-facing types for the in-form DOCX editor's version history. The diff
// engine's own types (Hunk, ChangeList, Slice) live in ./sfdtDiff/types and are
// re-exported so callers have a single import surface.
export type { AuthorKey, ChangeList, Hunk, Slice } from './sfdtDiff/types';

/** Who made an edit. `key` is the stable identity used for colour and slice
 *  attribution (the current viewer is always 'you'); `label` is for display. */
export interface VersionAuthor {
  kind: 'user' | 'assistant';
  key: string;
  label: string;
}

/** Attribution proven by the live preview, scoped to its editing session. */
export interface LiveSessionAuthors {
  sessionId: string;
  authors: VersionAuthor[];
}

/** Extra multipart fields the autosave PATCH carries so the backend can group
 *  saves into one version row. Absent → the PATCH behaves as it always has. */
export interface DocxSaveMeta {
  sessionId: string;
  sessionStartedAt: string; // ISO 8601
  authors: Array<{ kind: VersionAuthor['kind']; label: string; key?: string }>;
  collaboratorId?: string;
  /** True when this flush is the last save of the session. */
  closeSession?: boolean;
  /** Local-only form write-back snapshot; never sent as history metadata. */
  bindingValues?: Record<string, string>;
}

/** One version row as the list/detail endpoints serialize it
 *  (apps/document/serializers.py EnvelopeVersionSerializer). File fields are
 *  presigned URLs, null on the open/current row. */
export interface DocxVersion {
  id: string;
  session_id: string | null;
  seq: number;
  is_baseline: boolean;
  is_current: boolean;
  name: string;
  started_at: string;
  ended_at: string;
  closed_at: string | null;
  authors: Array<{ kind: VersionAuthor['kind']; label: string; key?: string }>;
  actor_label: string;
  actor_name: string;
  restored_from: string | null;
  restored_from_at: string | null;
  editor_file: string | null;
  file: string | null;
  final_sfdt: string | null;
  changes: string | null;
  change_count: number | null;
  format_change_count: number | null;
  final_sha256: string;
  highlights_pruned_at: string | null;
  created_at: string;
}

/** Payload for closing a session: the final document plus (later PRs) its
 *  anchored change list. In PR 2 only `finalSfdtGz` is sent; the diff fields
 *  arrive with the highlights PR. */
export interface CloseVersionPayload {
  finalSfdtGz: Blob;
  changesJson?: Blob;
  changeCount: number | null;
  formatChangeCount: number | null;
  finalSha256: string;
  startSha256: string;
  authors: DocxSaveMeta['authors'];
}

/**
 * The I/O adapter the container injects so the history modules never import the
 * Feathery API directly (index.tsx stays API-free, per its :98 comment).
 */
export interface DocxHistoryHost {
  listVersions(): Promise<DocxVersion[]>;
  /** Refresh signed artifact URLs after expiry. */
  getVersion?(versionId: string): Promise<DocxVersion>;
  closeVersion(
    sessionId: string,
    payload: CloseVersionPayload
  ): Promise<DocxVersion | null>;
  fetchVersionFile(url: string): Promise<ArrayBuffer>;
  /** Return the created row when available so the UI can select it directly. */
  restoreVersion(versionId: string): Promise<DocxVersion | void>;
  renameVersion(versionId: string, name: string): Promise<DocxVersion>;
}

export type SaveStatus =
  | 'clean'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'error'
  | 'blocked';
