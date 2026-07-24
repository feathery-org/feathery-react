import { useCallback, useEffect, useRef, useState } from 'react';
import { featheryDoc, featheryWindow } from '../../../utils/browser';
import { dynamicImport } from '../../../integrations/utils';
import { EJ2_SCRIPT_URL, EJ2_STYLE_URLS } from './constants';
import { DocxSource } from './types';

// Inject the Syncfusion theme CSS once (deduped across all editor instances).
const LOADED_STYLES = new Set<string>();
function loadStyles() {
  const doc = featheryDoc();
  EJ2_STYLE_URLS.forEach((href) => {
    if (LOADED_STYLES.has(href)) return;
    LOADED_STYLES.add(href);
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    doc.head.appendChild(link);
  });
}

async function resolveBuffer(source: DocxSource): Promise<ArrayBuffer> {
  if ('buffer' in source) return source.buffer;
  const res = await fetch(source.url);
  if (!res.ok) {
    throw new Error(`Failed to fetch document (${res.status})`);
  }
  return res.arrayBuffer();
}

// scriptjs can report the CDN bundle "loaded" a beat before the (multi-MB) ej2
// UMD finishes attaching `ej` to window (notably under Next). Poll for it rather
// than checking once.
function waitForEj(timeoutMs = 15000): Promise<any> {
  return new Promise((resolve) => {
    const done = () => (featheryWindow() as any).ej?.documenteditor;
    if (done()) return resolve((featheryWindow() as any).ej);
    const start = Date.now();
    const iv = setInterval(() => {
      if (done() || Date.now() - start > timeoutMs) {
        clearInterval(iv);
        resolve((featheryWindow() as any).ej);
      }
    }, 50);
  });
}

interface Props {
  source?: DocxSource;
  licenseKey?: string;
  serviceUrl?: string;
  /** Extra headers for Syncfusion serviceUrl requests (e.g. Feathery auth). */
  headers?: Record<string, string>[];
  readOnly?: boolean;
  /** Bump to force a reopen of the same source URL (e.g. after regenerate). */
  openNonce?: number;
  onReady?: () => void;
  /** Hands the live DocumentEditor instance to the host (e.g. the AI assistant
   *  drives the document directly through this — no iframe boundary). */
  onEditorReady?: (editor: any) => void;
  onDirty?: () => void;
  onError?: (error: string) => void;
}

interface Result {
  containerRef: React.RefObject<HTMLDivElement | null>;
  editor: any;
  loading: boolean;
  error: string | null;
  exportDoc: () => Promise<Blob>;
  resize: () => void;
}

// Loads Syncfusion from the CDN at runtime and mounts the DocumentEditorContainer
// directly into the page (no iframe). The editor instance is exposed so the
// toolbar — and the AI assistant — can drive it via its API directly.
export function useDocxEditor({
  source,
  licenseKey,
  serviceUrl,
  headers,
  readOnly,
  openNonce = 0,
  onReady,
  onEditorReady,
  onDirty,
  onError
}: Props): Result {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerInstRef = useRef<any>(null);
  // Ignore Syncfusion contentChange while we are programmatically opening a
  // document — those events fire during load/destroy and must not mark dirty
  // or kick off host re-renders mid-flight.
  const ignoreContentChangeRef = useRef(true);
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const [editor, setEditor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isReadOnly = !!readOnly;

  const fail = useCallback(
    (err: unknown) => {
      const msg = (err as Error)?.message || String(err);
      console.error('Feathery document editor error:', msg);
      setError(msg);
      setLoading(false);
      onError?.(msg);
    },
    [onError]
  );

  const headersKey = JSON.stringify(headers ?? []);

  // Load the CDN assets and instantiate the editor. Recreated only if license
  // or serviceUrl changes — NOT on readOnly toggles (those update in place).
  // Recreating mid-fetch/open destroys Syncfusion while it still holds null
  // internal state and surfaces as "Cannot convert undefined or null to object".
  useEffect(() => {
    let cancelled = false;
    let instance: any = null;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        ignoreContentChangeRef.current = true;
        loadStyles();
        await dynamicImport(EJ2_SCRIPT_URL);
        const ej = await waitForEj();
        if (cancelled) return;
        if (!ej?.documenteditor) {
          throw new Error('Syncfusion Document Editor failed to load');
        }
        if (!containerRef.current) return;

        if (licenseKey) ej.base.registerLicense(licenseKey);
        ej.documenteditor.DocumentEditorContainer.Inject(
          ej.documenteditor.Toolbar
        );
        instance = new ej.documenteditor.DocumentEditorContainer({
          enableToolbar: false,
          showPropertiesPane: false,
          serviceUrl: serviceUrl || '',
          headers: headers || [],
          height: '100%'
        });
        // Wait until Syncfusion finishes creating the inner DocumentEditor —
        // opening a doc before `created` leaves a blank default document.
        await new Promise<void>((resolve, reject) => {
          const t = featheryWindow().setTimeout(
            () => reject(new Error('Document editor failed to create')),
            15000
          );
          instance.addEventListener('created', () => {
            featheryWindow().clearTimeout(t);
            resolve();
          });
          instance.appendTo(containerRef.current);
        });
        if (cancelled) return;
        containerInstRef.current = instance;

        const ed = instance.documentEditor;
        if (!ed) {
          throw new Error('Document editor instance missing after create');
        }
        ed.isReadOnly = isReadOnly;
        ed.addEventListener('contentChange', () => {
          if (ignoreContentChangeRef.current) return;
          onDirtyRef.current?.();
        });
        // Native right-click menu — insert/delete table rows & columns,
        // cut/copy/paste, etc. (the built-in toolbar is disabled).
        ed.enableContextMenu = true;
        setEditor(ed);
        onEditorReady?.(ed);

        // With no source the editor opens a blank document immediately.
        if (!source) {
          ignoreContentChangeRef.current = false;
          setLoading(false);
          onReady?.();
        }
      } catch (err) {
        if (!cancelled) fail(err);
      }
    })();

    return () => {
      cancelled = true;
      ignoreContentChangeRef.current = true;
      setEditor(null);
      try {
        instance?.destroy?.();
      } catch {
        /* editor already torn down */
      }
      containerInstRef.current = null;
    };
    // `source` / `isReadOnly` intentionally omitted — open and readOnly are
    // handled by sibling effects so we never tear down mid-fetch.
  }, [licenseKey, serviceUrl, headersKey]);

  // Apply read-only in place; do not recreate the editor.
  useEffect(() => {
    if (!editor) return;
    editor.isReadOnly = isReadOnly;
  }, [editor, isReadOnly]);

  // Open / re-open the source document. Syncfusion's open() takes SFDT text —
  // NOT a .docx blob — so a .docx is converted server-side first: POST it to
  // `${serviceUrl}Import` (multipart field "files"); the response is SFDT,
  // sometimes wrapped in `{"sfdt": "..."}` depending on the service build.
  // Depend on the URL/buffer identity (not the wrapper object) so parent
  // re-renders that recreate `{ url }` don't cancel an in-flight open.
  const sourceUrl = source && 'url' in source ? source.url : undefined;
  const sourceBuffer = source && 'buffer' in source ? source.buffer : undefined;

  useEffect(() => {
    if (!editor || (!sourceUrl && !sourceBuffer)) return;
    let cancelled = false;
    const openSource: DocxSource = sourceBuffer
      ? { buffer: sourceBuffer }
      : { url: sourceUrl as string };

    (async () => {
      try {
        ignoreContentChangeRef.current = true;
        setLoading(true);
        setError(null);
        const buffer = await resolveBuffer(openSource);
        if (cancelled) return;
        if (!serviceUrl) {
          throw new Error('serviceUrl is required to open a .docx');
        }
        // Match the dashboard DocxPage path: hand Syncfusion the .docx blob
        // and let it convert via serviceUrl. Manual Import→SFDT was returning
        // optimized/base64 SFDT that open() often left as a blank document.
        const blob = new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });
        const liveEditor = containerInstRef.current?.documentEditor ?? editor;
        if (typeof liveEditor.openAsync === 'function') {
          await liveEditor.openAsync(blob);
        } else {
          liveEditor.open(blob);
        }
        if (cancelled) return;
        ignoreContentChangeRef.current = false;
        setLoading(false);
        onReady?.();
      } catch (err) {
        if (!cancelled) fail(err);
      }
    })();

    return () => {
      cancelled = true;
      ignoreContentChangeRef.current = true;
    };
  }, [editor, sourceUrl, sourceBuffer, serviceUrl, openNonce]);
  const exportDoc = useCallback((): Promise<Blob> => {
    if (!editor) return Promise.reject(new Error('Editor is not ready'));
    return editor.saveAsBlob('Docx');
  }, [editor]);

  const resize = useCallback(() => containerInstRef.current?.resize?.(), []);

  return { containerRef, editor, loading, error, exportDoc, resize };
}
