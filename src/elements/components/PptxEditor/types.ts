import type { Deck } from './core/model/types';
import type { PptxChangeRecord } from './engine/changes';

export type PptxSource = { url: string } | { buffer: ArrayBuffer };

export interface PptxVersion {
  id: string;
  name?: string;
  createdAt: string;
  fileUrl: string;
  sessionId?: string;
}

/**
 * Host adapter for version history (Phase 7 seam). The host owns every network
 * call; the editor never touches Feathery clients or backend routes directly.
 */
export interface PptxHistoryHost {
  listVersions(): Promise<PptxVersion[]>;
  saveVersion(input: {
    file: Blob;
    sessionId: string;
    changes: PptxChangeRecord[];
    finalSha256: string;
  }): Promise<PptxVersion>;
  fetchVersionFile(url: string): Promise<ArrayBuffer>;
  restoreVersion(versionId: string): Promise<void>;
  renameVersion(versionId: string, name: string): Promise<PptxVersion>;
}

export interface PptxEditorProps {
  source?: PptxSource;
  fileName?: string;
  readOnly?: boolean;
  visible?: boolean;
  hideDownload?: boolean;
  reviewChanges?: boolean;
  /** Bump to force a reload of the same source (mirrors DocxEditor). */
  openNonce?: number;
  onReady?: () => void;
  /** Packet-owned preparation cache; transfers the deck to this editor. */
  prepareSource?: (signal: AbortSignal) => Promise<Deck>;
  onChange?: (dirty: boolean) => void;
  /** A failed operation (save) on a document that stays open and editable. */
  onError?: (message: string) => void;
  /** The document could not be opened at all; falls back to onError. */
  onLoadError?: (message: string) => void;
  onBeforeReplaceReady?: (save: (() => Promise<unknown>) | null) => void;
  onSave?: (blob: Blob) => unknown | Promise<unknown>;
  onSaved?: () => void | Promise<void>;
  onSaveAll?: () => Promise<void>;
  onDownloadAll?: () => Promise<void>;
  /** Convert the saved presentation to PDF (host calls the backend). When set,
   * the editor offers "Download as PDF" alongside the native .pptx download. */
  onExportPdf?: () => Promise<Blob>;
  historyHost?: PptxHistoryHost;
  /** Developer flag: show the live JSON side panel toggle. */
  devJsonPanel?: boolean;
}
