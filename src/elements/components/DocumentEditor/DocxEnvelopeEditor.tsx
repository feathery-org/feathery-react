import React, { useCallback, useEffect, useRef, useState } from 'react';
import DocxEditor from '../DocxEditor/index';
import type FeatheryClient from '../../../utils/featheryClient';
import { API_URL } from '../../../utils/featheryClient';
import { featheryWindow } from '../../../utils/browser';
import { fieldValues, initState, setFieldValues } from '../../../utils/init';
import { containerToolbarOutcomes } from '../../../utils/document';
import { runEnvelopeSigningAction } from './envelopeSigning';
import {
  registerDocxEditor,
  unregisterDocxEditor
} from '../../../assistant/tools/docx/docxEditorRegistry';
import { rebindRevisionGroups } from '../../../utils/documentEditorPrimitives';
import {
  clearDocxEditorDirty,
  setDocxEditorDirty
} from '../DocxEditor/docxDirtyRegistry';

export interface Envelope {
  id: string;
  file: string | null;
  // Control-bearing docx copy for the editor; `file` is the stripped public
  // copy. Null/absent for non-docx envelopes and control-free docx.
  editor_file?: string | null;
  document?: string;
  type: string;
  signed: boolean;
}

// The editor must open the control-bearing copy when the envelope has one;
// legacy and control-free envelopes only have the public `file`.
export function envelopeSourceUrl(
  envelope?: Envelope | null
): string | undefined {
  return envelope?.editor_file ?? envelope?.file ?? undefined;
}

/**
 * FLIP THIS TO TEST DOCUMENT BINDINGS. Ships false.
 *
 * Turns on the [[...]] binding engine for every DocxEditor in the bundle:
 * template tokens become content controls, formulas compute, and edits
 * reconcile on Enter or blur. The per-host switch is
 * window.featherySyncfusion.bindings; this is the blunt version, for when
 * rebuilding the package is easier than arranging for that global to be set
 * before the editor mounts.
 *
 * Two things follow from it being a compile-time constant:
 *   - flipping it needs a `yarn build` and a re-link into the consuming app;
 *   - it applies globally, so leave it false on anything shared.
 */
const FORCE_DOCUMENT_BINDINGS = true;

interface DocxEnvelopeEditorProps {
  envelope: Envelope;
  // The Generate Documents action that owns the document: it configures the
  // toolbar outcomes, read-only state, signers, and sign method.
  action?: Record<string, any>;
  client: FeatheryClient;
  // Kept separate from envelope.file by the owner so a plain save (which
  // refreshes the envelope's file URLs) doesn't reload the document out from
  // under the user.
  source?: { url: string };
  // Bumped by the owner to force the editor to reload its source after a
  // (re)generate.
  openNonce?: number;
  // Key for the assistant + unsaved-changes registries. A document-editor
  // container passes its schema container id; other hosts pass their own
  // stable key. Absent = no registration.
  registryKey?: string;
  formId?: string;
  stepId?: string;
  assistantEnabled?: boolean;
  // Loading fallback while the envelope's own document id settles — the
  // loaded envelope is authoritative when an action generates several
  // documents.
  defaultDocumentId?: string;
  // A save refreshes the envelope's file URLs; the owner keeps its envelope
  // state in sync through this.
  onEnvelopeUpdated?: (updated: {
    file: string;
    editor_file?: string | null;
  }) => void;
  // Without this a failed send is swallowed: DocxEditor routes terminal
  // errors here and there is nothing else listening.
  onError: (message: string) => void;
}

// The docx renderer: the reusable Syncfusion DocxEditor wired to a generated
// envelope — saving overwrites the envelope in place, and the terminal
// actions (sign/draft/download/save-to-field) come off the owning action's
// `editor_toolbar_actions`. Surface-agnostic: the document-editor container
// and the overlay both render it.
export default function DocxEnvelopeEditor({
  envelope,
  action,
  client,
  source,
  openNonce = 0,
  registryKey,
  formId,
  stepId,
  assistantEnabled,
  defaultDocumentId,
  onEnvelopeUpdated,
  onError
}: DocxEnvelopeEditorProps) {
  // Envelope that was finalized for signing (docx → signable PDF) this
  // session. Keyed by id so a regenerated envelope is editable again without
  // any reset wiring.
  const [finalizedId, setFinalizedId] = useState<string | null>(null);

  // Read from window each render. Do NOT useMemo([]) — on Next.js SSR
  // featheryWindow() is {} so a mount-once memo freezes serviceUrl as
  // undefined and the editor never opens the generated docx.
  // Default serviceUrl is the Feathery backend proxy (hides the self-hosted
  // Word Processor). window.featherySyncfusion may override for local smoke
  // tests; licenseKey is optional (server license lives on the Word Processor).
  const syncfusion = (featheryWindow() as any).featherySyncfusion ?? {};
  const serviceUrl = syncfusion.serviceUrl || `${API_URL}document/editor/`;
  // Read initState directly instead of initInfo() — initInfo() throws when
  // the SDK isn't initialized (tests, designer preview).
  const { sdkKey } = initState;
  const serviceHeaders = syncfusion.headers
    ? syncfusion.headers
    : sdkKey
    ? [{ Authorization: `Token ${sdkKey}` }]
    : [];

  // The loaded editor is authoritative. If a generate action contains several
  // documents, the envelope actually displayed here wins over the action's
  // first-document loading default.
  const activeDocumentId = envelope.document ?? defaultDocumentId;
  // Signed envelopes are always read-only. Otherwise the Generate Documents
  // action that owns the document controls editability via
  // `editor_read_only` (default: editable).
  const actionReadOnly =
    typeof action?.editor_read_only === 'boolean'
      ? action.editor_read_only
      : false;
  const finalized = envelope.id === finalizedId;
  const readOnly = !!envelope.signed || !!actionReadOnly || finalized;
  // The outcomes this editor offers, read from `editor_toolbar_actions`. See
  // containerToolbarOutcomes.
  const { terminalAction, offersDraft, offersDownload, savesToField } =
    containerToolbarOutcomes(action ?? {});
  const reviewChanges = !!assistantEnabled && !readOnly;

  // Opt-in, and off unless a host asks for it: window.featherySyncfusion.bindings
  // rides the same config object that already carries serviceUrl and licenseKey,
  // or FORCE_DOCUMENT_BINDINGS is flipped for local testing.
  const bindingsEnabled =
    FORCE_DOCUMENT_BINDINGS || syncfusion.bindings === true;
  // The most recent committed document-field values, read at save time.
  const bindingValuesRef = useRef<Record<string, string>>({});

  const saveEnvelope = useCallback(
    async (blob: Blob) => {
      const updated = await client.saveEnvelopeFile(
        envelope.id,
        blob,
        'document.docx'
      );
      const savedFileUrl = updated?.file ?? envelope.file;
      if (updated?.file) {
        onEnvelopeUpdated?.({
          file: updated.file,
          editor_file: updated.editor_file ?? null
        });
      }
      const newValues: Record<string, any> = {};
      if (savesToField && action?.save_document_field_key && savedFileUrl) {
        newValues[action.save_document_field_key] = savedFileUrl;
      }
      // Document-level bindings write back to form fields of the same name, and
      // ONLY to fields the form already has - a binding in a template is not
      // permission to invent a field. Pushed here with the save rather than on
      // every reconcile: pressing Enter should not cost a network round trip.
      for (const [name, value] of Object.entries(bindingValuesRef.current)) {
        if (name in fieldValues) newValues[name] = value;
      }
      if (Object.keys(newValues).length) {
        setFieldValues(newValues, true, true);
        await client.submitCustom(newValues);
      }
      return updated;
    },
    [client, envelope, action, savesToField, onEnvelopeUpdated]
  );

  // Only the signing actions run here; 'download' is handled inside DocxEditor,
  // which saves first and then serves the envelope's public (stripped) copy.
  const runSigningAction = useCallback(
    (draft: boolean) =>
      runEnvelopeSigningAction({
        envelope,
        action,
        client,
        formId,
        activeDocumentId,
        draft,
        onFinalized: () => setFinalizedId(envelope.id)
      }),
    [client, envelope, action, activeDocumentId, formId]
  );

  // 'draft' as the terminal action means Create Draft is the only signing
  // outcome configured; offersDraft puts it in a menu beside Sign instead.
  const runTerminalAction = useCallback(
    () => runSigningAction(terminalAction === 'draft'),
    [runSigningAction, terminalAction]
  );
  const runTerminalActionDraft = useCallback(
    () => runSigningAction(true),
    [runSigningAction]
  );

  // DocxEditor exposes its live SyncFusion instance at this exact lifecycle
  // point. The registry key is stable for this editor across renders; retain
  // the editor object as well so cleanup can only remove this exact
  // registration, never another mounted editor's.
  const registeredEditor = useRef<any>(undefined);
  const onEditorReady = useCallback(
    (editor: any) => {
      if (!registryKey) return;
      registeredEditor.current = editor;
      registerDocxEditor(registryKey, editor, {
        formId,
        stepId,
        documentId: activeDocumentId,
        envelopeId: envelope.id
      });
    },
    [activeDocumentId, registryKey, envelope.id, formId, stepId]
  );
  // Runs after openAsync resolves — and again on every reload (openNonce), which
  // is the case that matters: the in-memory group wrappers die with the old
  // document, while the customData tags survive in the saved file. Rebinding
  // here is what lets a reloaded document regain its atomic accept groups.
  // Idempotent (already-bound revisions are skipped), so the blank-document
  // firing of this same callback is a harmless no-op.
  const onDocumentReady = useCallback(() => {
    const editor = registeredEditor.current;
    if (!editor || !reviewChanges) return;
    try {
      rebindRevisionGroups(editor);
    } catch {
      // A grouping failure must not break the opened document.
    }
  }, [reviewChanges]);
  // Envelope identity can settle after SyncFusion's created callback. Refresh
  // only the assistant registration; the editor itself stays mounted.
  useEffect(() => {
    if (!registryKey || !registeredEditor.current) return;
    registerDocxEditor(registryKey, registeredEditor.current, {
      formId,
      stepId,
      documentId: activeDocumentId,
      envelopeId: envelope.id
    });
  }, [activeDocumentId, registryKey, envelope.id, formId, stepId]);
  useEffect(
    () => () => {
      if (registryKey) {
        clearDocxEditorDirty(formId, registryKey);
        if (registeredEditor.current) {
          unregisterDocxEditor(registryKey, registeredEditor.current, formId);
        }
      }
    },
    [registryKey, formId]
  );

  if (!serviceUrl) {
    console.warn(
      'Feathery: document editor serviceUrl is not set — cannot convert/open the .docx'
    );
  }

  return (
    <DocxEditor
      source={source}
      serviceUrl={serviceUrl}
      headers={serviceHeaders}
      licenseKey={syncfusion.licenseKey}
      readOnly={readOnly}
      reviewChanges={reviewChanges}
      openNonce={openNonce}
      fileName='document'
      terminalAction={terminalAction}
      onTerminalAction={terminalAction ? runTerminalAction : undefined}
      onTerminalActionDraft={offersDraft ? runTerminalActionDraft : undefined}
      // Signing needs a signer to open as, which only finalizing an unsigned
      // envelope hands back - so there's nothing behind the button once signed.
      terminalActionDisabled={!envelope.file || envelope.signed}
      onError={onError}
      // Download shows only when the toolbar config offers it, and never in
      // the save-to-field flow: there the document's destination is a form
      // field (set on every save), not the user's machine.
      hideDownload={savesToField || !offersDownload}
      // Downloads serve the stripped public copy, never the editor bytes —
      // content controls must not leave the platform.
      downloadUrl={envelope.file ?? undefined}
      bindings={{
        enabled: bindingsEnabled,
        onFieldValues: (values) => {
          bindingValuesRef.current = values;
        }
      }}
      onSave={saveEnvelope}
      // readOnly editors never dirty, so skip registering them entirely
      onChange={
        !readOnly && registryKey
          ? (dirty: boolean) => setDocxEditorDirty(formId, registryKey, dirty)
          : undefined
      }
      onEditorReady={onEditorReady}
      onReady={onDocumentReady}
      // Server-side docx→pdf conversion (doc-conversion Lambda); does not
      // persist anything — the envelope stays an editable docx.
      onExportPdf={() => client.downloadEnvelopePdf(envelope.id)}
    />
  );
}
