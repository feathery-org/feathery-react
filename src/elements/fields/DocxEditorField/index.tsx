import React, { useEffect, useState } from 'react';
import DocxEditor from '../../components/DocxEditor';
import { DocxSource } from '../../components/DocxEditor/types';
import ErrorInput from '../../components/ErrorInput';
import { featheryWindow } from '../../../utils/browser';
import {
  registerDocxEditor,
  unregisterDocxEditor
} from '../../../assistant/tools/docxEditorRegistry';

// Form field wrapper around the standalone DocxEditor. Its value is the edited
// .docx (stored like a file field). `serviceUrl`/`licenseKey` are injected by
// the host via the dispatcher (from form/integration config), never hardcoded.
const DocxEditorField = ({
  element,
  responsiveStyles,
  editMode,
  disabled = false,
  // Current field value: a File / Promise<File> (a previously saved edit) or ''.
  defaultValue = null,
  // Writes the field value — the dispatcher wires this to changeValue().
  onSave,
  serviceUrl,
  licenseKey,
  // Form instance id (from the dispatcher) used to register the mounted editor
  // so the Robin assistant's docx ops can reach it.
  instanceId,
  // Optional passthrough for hosts that want the live editor directly.
  onEditorReady,
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
  const [editor, setEditor] = useState<any>(null);

  // Register the mounted DocumentEditor so the Robin assistant's docx bridge
  // (getDocumentInventory/applyDocumentEdits) can act on this field's editor.
  // Unregisters on unmount / when the editor instance changes.
  useEffect(() => {
    if (!editor || !instanceId) return;
    registerDocxEditor(instanceId, editor);
    return () => unregisterDocxEditor(instanceId, editor);
  }, [editor, instanceId]);

  // Resolve the current value (File / Promise<File>) into bytes for the editor.
  // Falls back to a configured template URL, else opens a blank document.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const val = await Promise.resolve(defaultValue).catch(() => null);
      if (cancelled) return;
      if (val instanceof Blob) {
        const buffer = await val.arrayBuffer();
        if (!cancelled) setSource({ buffer });
      } else if (meta.template_url) {
        setSource({ url: meta.template_url });
      } else {
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
        ...responsiveStyles?.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      <DocxEditor
        source={source}
        serviceUrl={resolvedServiceUrl}
        licenseKey={resolvedLicenseKey}
        readOnly={disabled || !!meta.read_only}
        hideDownload={!!meta.hide_download}
        fileName={servar.key}
        onSave={(blob: Blob) => onSave?.(blob)}
        onEditorReady={(ed: any) => {
          setEditor(ed);
          onEditorReady?.(ed);
        }}
      />
      {/* Always rendered so the Form can set validation errors on this field. */}
      <ErrorInput id={servar.key} name={servar.key} />
    </div>
  );
};

export default DocxEditorField;
