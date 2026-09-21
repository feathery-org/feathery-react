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
  onChange?: (dirty: boolean) => void;
  onError?: (message: string) => void;
  onSave?: (blob: Blob) => unknown | Promise<unknown>;
  historyHost?: PptxHistoryHost;
  /** Developer flag: show the live JSON side panel toggle. */
  devJsonPanel?: boolean;
}
