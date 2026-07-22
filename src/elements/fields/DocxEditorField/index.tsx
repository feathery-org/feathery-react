import React, { useEffect, useRef, useState } from 'react';
import DocxEditor from '../../components/DocxEditor';
import { DocxSource } from '../../components/DocxEditor/types';
import ErrorInput from '../../components/ErrorInput';
import { featheryWindow } from '../../../utils/browser';

// Form field wrapper around the standalone DocxEditor. Its value is the edited
// .docx (stored like a file field). `serviceUrl`/`licenseKey` are injected by
// the host via the dispatcher (from form/integration config), never hardcoded.
const DocxEditorField = ({
  element,
  responsiveStyles,
  editMode,
  disabled = false,
  // Current field value: a File / Promise<File> (a previously saved edit), an
  // envelope reference ({ envelope_id, file_url }) written by the Generate
  // Documents action, or ''.
  defaultValue = null,
  // Writes the field value — the dispatcher wires this to changeValue().
  onSave,
  // Persists edits back onto a generated envelope — the dispatcher wires this
  // to the backend envelope file endpoint. Used when the value is an envelope
  // reference.
  onSaveEnvelope,
  serviceUrl,
  licenseKey,
  elementProps = {},
  children
}: any) => {
  const servar = element.servar ?? {};
  const meta = servar.metadata ?? {};
  // Config resolution order: prop injected by the host dispatcher → the host's
  // environment config (set on this global from env vars) → per-element metadata.
  const envCfg = (featheryWindow() as any).featherySyncfusion ?? {};
  const resolvedServiceUrl =
    serviceUrl || envCfg.serviceUrl || meta.service_url;
  const resolvedLicenseKey =
    licenseKey || envCfg.licenseKey || meta.license_key;
  const [source, setSource] = useState<DocxSource | undefined>(undefined);
  const [envelopeId, setEnvelopeId] = useState<string | undefined>(undefined);
  // Envelope whose file is currently open, so a value update that only
  // refreshes the reference (e.g. a new signed URL after saving) doesn't
  // reload the document out from under the user.
  const loadedEnvelopeRef = useRef<string | null>(null);

  // Resolve the current value into a document for the editor: saved bytes
  // (File / Promise<File>), a generated envelope reference or file URL, or a
  // configured template URL; else opens a blank document.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const val = await Promise.resolve(defaultValue).catch(() => null);
      if (cancelled) return;
      if (val instanceof Blob) {
        const buffer = await val.arrayBuffer();
        if (cancelled) return;
        loadedEnvelopeRef.current = null;
        setEnvelopeId(undefined);
        setSource({ buffer });
      } else if (val && typeof val === 'object' && val.file_url) {
        setEnvelopeId(val.envelope_id);
        if (!val.envelope_id || loadedEnvelopeRef.current !== val.envelope_id) {
          loadedEnvelopeRef.current = val.envelope_id ?? null;
          setSource({ url: val.file_url });
        }
      } else if (typeof val === 'string' && val.startsWith('http')) {
        loadedEnvelopeRef.current = null;
        setEnvelopeId(undefined);
        setSource({ url: val });
      } else if (meta.template_url) {
        loadedEnvelopeRef.current = null;
        setEnvelopeId(undefined);
        setSource({ url: meta.template_url });
      } else {
        loadedEnvelopeRef.current = null;
        setEnvelopeId(undefined);
        setSource(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [defaultValue, meta.template_url]);

  // In the builder canvas, show a placeholder instead of loading the multi-MB
  // Syncfusion editor (which also needs a live service).
  if (editMode) {
    return (
      <div
        css={{
          width: '100%',
          height: 600,
          minHeight: 240,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px dashed #d4d4d8',
          borderRadius: 8,
          color: '#71717a',
          fontSize: 14,
          ...responsiveStyles?.getTarget('fc')
        }}
        {...elementProps}
      >
        {children}
        Document editor
      </div>
    );
  }

  return (
    <div
      css={{
        width: '100%',
        // Definite default height so the editor has room; the element's
        // configured height/width (Style panel → applied to 'fc') overrides it,
        // e.g. a fixed px height or 100% to fill a sized container.
        height: 600,
        position: 'relative',
        // The grid gives field cells `min-width: min-content`. Syncfusion's
        // min-content is a full document page (and it grows as the editor
        // re-lays-out on each click), so left in normal flow it drags the cell
        // ever wider. Clip here and take the editor out of flow (below) so it
        // fills the cell without contributing to its intrinsic width.
        minWidth: 0,
        overflow: 'hidden',
        ...responsiveStyles?.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      <div css={{ position: 'absolute', inset: 0 }}>
        <DocxEditor
          source={source}
          serviceUrl={resolvedServiceUrl}
          licenseKey={resolvedLicenseKey}
          readOnly={disabled || !!meta.read_only}
          hideDownload={!!meta.hide_download}
          fileName={servar.key}
          onSave={(blob: Blob) => {
            // Envelope-backed documents persist to the envelope; otherwise the
            // blob becomes the field value. Returning the promise lets the
            // editor surface errors and stay dirty on failure.
            if (envelopeId && onSaveEnvelope)
              return onSaveEnvelope(envelopeId, blob);
            return onSave?.(blob);
          }}
        />
      </div>
      {/* Always rendered so the Form can set validation errors on this field. */}
      <ErrorInput id={servar.key} name={servar.key} />
    </div>
  );
};

export default DocxEditorField;
