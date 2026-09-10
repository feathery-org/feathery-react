// Resolves the document to show for a selected version. When the version was
// closed with a final SFDT AND a change list, its hunks are applied so the
// viewer renders them as tracked-change highlights; without a change list it
// shows the document plain (degraded — a tab-death row, a >30-day pruned row, or
// a hash mismatch). An old docx-only row falls back to its stored docx.
import { useEffect, useRef, useState } from 'react';

import { populateVersionBindings } from './populateVersionBindings';
import { applyHunks, ChangeList } from './sfdtDiff/index';
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
  /** True when detailed per-author highlights are unavailable (no change list,
   *  pruned highlights, or a hash mismatch) — the document still opens plain. */
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

    const done = (next: Omit<VersionDocument, 'loading'>) => {
      if (id === reqId.current) setState({ loading: false, ...next });
    };

    (async () => {
      try {
        if (version.final_sfdt) {
          const finalSfdt = await gunzip(
            await host.fetchVersionFile(version.final_sfdt)
          );
          const finalDoc = JSON.parse(finalSfdt);

          // The plain (no-highlights) document with its [[field]] / {{ jinja }}
          // tokens populated, like the live editor does on open. A no-op for a
          // document that came from a live edit session (already content-
          // controlled), so it only fixes versions stored as a raw template.
          const plainSfdt = () => {
            try {
              const populated = populateVersionBindings(finalDoc);
              return populated === finalDoc ? finalSfdt : JSON.stringify(populated);
            } catch {
              return finalSfdt;
            }
          };

          // With a change list, apply the hunks so the viewer shows highlights.
          if (version.changes && version.change_count != null) {
            try {
              const changes: ChangeList = JSON.parse(
                await gunzip(await host.fetchVersionFile(version.changes))
              );
              // A hash mismatch means the hunks no longer describe this SFDT;
              // show the document plain rather than mis-anchored highlights.
              if (
                changes.final_sha256 &&
                version.final_sha256 &&
                changes.final_sha256 !== version.final_sha256
              ) {
                done({ error: false, sfdt: plainSfdt(), degraded: true });
                return;
              }
              // An empty change list carries no highlights; show it plain and
              // degraded rather than a "highlights on" view that paints nothing.
              if (!changes.hunks?.length) {
                done({ error: false, sfdt: plainSfdt(), degraded: true });
                return;
              }
              const display = applyHunks(finalDoc, changes);
              done({
                error: false,
                sfdt: JSON.stringify(display),
                editCount: changes.changeCount,
                formatCount: changes.formatChangeCount,
                degraded: false
              });
              return;
            } catch {
              // Corrupt/failed change list: fall back to the plain document.
              done({ error: false, sfdt: plainSfdt(), degraded: true });
              return;
            }
          }

          done({ error: false, sfdt: plainSfdt(), degraded: true });
          return;
        }

        const docxUrl = version.editor_file ?? version.file;
        if (!docxUrl) throw new Error('version has no document');
        done({ error: false, docxUrl, degraded: true });
      } catch {
        done({ error: true, degraded: true });
      }
    })();
  }, [host, version]);

  return state;
}
