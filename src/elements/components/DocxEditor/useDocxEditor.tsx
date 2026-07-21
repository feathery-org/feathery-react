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
  if (!res.ok) throw new Error(`Failed to fetch document (${res.status})`);
  return res.arrayBuffer();
}

interface Props {
  source?: DocxSource;
  licenseKey?: string;
  serviceUrl?: string;
  readOnly?: boolean;
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
  readOnly,
  onReady,
  onEditorReady,
  onDirty,
  onError
}: Props): Result {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerInstRef = useRef<any>(null);
  const [editor, setEditor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => {
      const msg = (err as Error)?.message || String(err);
      setError(msg);
      setLoading(false);
      onError?.(msg);
    },
    [onError]
  );

  // Load the CDN assets and instantiate the editor. Recreated only if the
  // editor's config (license/service/readOnly) changes.
  useEffect(() => {
    let cancelled = false;
    let instance: any = null;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        loadStyles();
        await dynamicImport(EJ2_SCRIPT_URL);
        const ej = (featheryWindow() as any).ej;
        if (!ej?.documenteditor) {
          throw new Error('Syncfusion Document Editor failed to load');
        }
        if (cancelled || !containerRef.current) return;

        if (licenseKey) ej.base.registerLicense(licenseKey);
        ej.documenteditor.DocumentEditorContainer.Inject(
          ej.documenteditor.Toolbar
        );
        instance = new ej.documenteditor.DocumentEditorContainer({
          enableToolbar: false,
          showPropertiesPane: false,
          serviceUrl: serviceUrl || '',
          height: '100%'
        });
        instance.appendTo(containerRef.current);
        containerInstRef.current = instance;

        const ed = instance.documentEditor;
        ed.isReadOnly = !!readOnly;
        ed.addEventListener('contentChange', () => onDirty?.());
        setEditor(ed);
        onEditorReady?.(ed);

        // With no source the editor opens a blank document immediately.
        if (!source) {
          setLoading(false);
          onReady?.();
        }
      } catch (err) {
        if (!cancelled) fail(err);
      }
    })();

    return () => {
      cancelled = true;
      try {
        instance?.destroy?.();
      } catch {
        /* editor already torn down */
      }
      containerInstRef.current = null;
    };
  }, [licenseKey, serviceUrl, readOnly]);

  // Open / re-open the source document. Syncfusion's open() takes SFDT text —
  // NOT a .docx blob — so a .docx is converted server-side first: POST it to
  // `${serviceUrl}Import` (multipart field "files"); the response is the SFDT
  // (the service's `{"sfdt": "..."}` wrapper, which open() accepts as-is).
  useEffect(() => {
    if (!editor || !source) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const buffer = await resolveBuffer(source);
        if (cancelled) return;
        if (!serviceUrl) {
          throw new Error('serviceUrl is required to open a .docx');
        }
        const importUrl = serviceUrl.replace(/\/+$/, '') + '/Import';
        const form = new FormData();
        // The filename extension tells the service the input format.
        form.append('files', new Blob([buffer]), 'document.docx');
        const res = await fetch(importUrl, { method: 'POST', body: form });
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(
            `DOCX import failed (HTTP ${res.status}) at ${importUrl}`
          );
        }
        // Pass the raw response body to open() (matches Syncfusion's sample
        // `open(responseText)`); do NOT unwrap to the inner string.
        editor.open(await res.text());
        if (cancelled) return;
        setLoading(false);
        onReady?.();
      } catch (err) {
        if (!cancelled) fail(err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editor, source, serviceUrl]);

  const exportDoc = useCallback((): Promise<Blob> => {
    if (!editor) return Promise.reject(new Error('Editor is not ready'));
    return editor.saveAsBlob('Docx');
  }, [editor]);

  const resize = useCallback(() => containerInstRef.current?.resize?.(), []);

  return { containerRef, editor, loading, error, exportDoc, resize };
}
