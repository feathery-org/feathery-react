// Resolves the document to show for a selected version. A version that was
// closed with a final SFDT opens that (fetched + inflated); an older docx-only
// row (a tab-death session, or one predating the highlights PR) falls back to
// its stored docx, opened through the Word Processor service.
//
// PR 4 shows the version as it stood — no per-author highlights yet; those, and
// the applyHunks display document, arrive with the highlights PR.
import { useEffect, useRef, useState } from 'react';

import { DocxHistoryHost, DocxVersion } from './types';

export interface VersionDocument {
  loading: boolean;
  error: boolean;
  /** SFDT string to open directly (the version had a final SFDT). */
  sfdt?: string;
  /** Docx URL to open through the service (no final SFDT — the fallback). */
  docxUrl?: string;
  /** True when detailed per-author highlights are unavailable for this version
   *  (always true in PR 4; refined once highlights land). */
  degraded: boolean;
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
    const id = ++reqId.current;
    setState({ loading: true, error: false, degraded: true });

    (async () => {
      try {
        if (version.final_sfdt) {
          const buffer = await host.fetchVersionFile(version.final_sfdt);
          const sfdt = await gunzip(buffer);
          if (id === reqId.current) {
            setState({ loading: false, error: false, sfdt, degraded: true });
          }
          return;
        }
        const docxUrl = version.editor_file ?? version.file;
        if (!docxUrl) throw new Error('version has no document');
        if (id === reqId.current) {
          setState({ loading: false, error: false, docxUrl, degraded: true });
        }
      } catch {
        if (id === reqId.current) {
          setState({ loading: false, error: true, degraded: true });
        }
      }
    })();
  }, [host, version]);

  return state;
}
