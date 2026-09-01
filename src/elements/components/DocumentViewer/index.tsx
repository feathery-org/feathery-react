import React, { useMemo, useRef, useState } from 'react';
import OverlaySurface from '../DocumentEditor/OverlaySurface';
import { ToolbarAction } from '../DocumentEditor/Toolbar';
import AlertBanner from '../DocumentEditor/AlertBanner';
import { isEditableTarget } from '../DocumentEditor/keyboard';
import PdfViewer, { PdfViewerApi, ViewerDocument } from './PdfViewer';

export type { ViewerDocument };

export type ReviewEnvelopeAction = 'sign' | 'fill' | 'download' | 'save';
export type EditorToolbarAction = ReviewEnvelopeAction | 'draft';

// Toolbar buttons render in this order, so the rightmost (primary) action is
// the most conclusive one the filler configured.
const TOOLBAR_ACTION_ORDER: EditorToolbarAction[] = [
  'download',
  'save',
  'draft',
  'sign'
];
const TOOLBAR_ACTION_LABELS: Record<EditorToolbarAction, string> = {
  sign: 'Sign',
  fill: 'Continue',
  download: 'Download',
  save: 'Save',
  draft: 'Create Draft'
};

// Actions that close the editor when pressed. Everything else runs its outcome
// and leaves the filler in the editor, so a configured signing action is still
// reachable afterwards — pressing Download shouldn't strand it.
//
// `sign` and `draft` both hand the documents off to DocuSign, so nothing is left
// to do here and either one closes even when both are offered. `fill` is the
// lone "Continue" shown for an unconfigured toolbar — by definition the only way
// forward.
const CLOSING_TOOLBAR_ACTIONS: EditorToolbarAction[] = [
  'sign',
  'draft',
  'fill'
];

/** Whether pressing `action` should close the editor, given what the toolbar
 * offers. Anything not inherently conclusive closes only when it is the
 * highest-priority action available — so Download closes only when it stands
 * alone, and Save only when no signing action is offered. */
export const closesEditor = (
  action: EditorToolbarAction,
  available: EditorToolbarAction[]
) => {
  if (CLOSING_TOOLBAR_ACTIONS.includes(action)) return true;
  const offered = TOOLBAR_ACTION_ORDER.filter((a) => available.includes(a));
  return action === offered[offered.length - 1];
};
// A draft button finalizes as a sign with draft=true — DocuSign is the only
// backend with a draft state, so there is no separate envelope action for it.
const TOOLBAR_ACTION_ENVELOPE_ACTION: Record<
  EditorToolbarAction,
  ReviewEnvelopeAction
> = {
  sign: 'sign',
  fill: 'fill',
  download: 'download',
  save: 'save',
  draft: 'sign'
};

const VIEWER_TITLE = 'Review Your Forms';

export interface DocumentViewerPayload {
  documents: ViewerDocument[];
  expires_at: string;
}

interface DocumentViewerProps {
  payload: DocumentViewerPayload;
  action: Record<string, any>;
  setShow: (show: boolean) => void;
  onComplete: () => void;
  // The toolbar exposes a single Continue action (label varies by
  // `envelope_action`) that calls this to finalize the reviewed envelopes.
  onFinalize?: (params: {
    envelopes: { envelopeId: string; signerId?: string }[];
    envelopeAction: ReviewEnvelopeAction;
    // DocuSign sign only: save the envelope as a draft instead of sending it.
    draft: boolean;
  }) => Promise<{ status?: string; message?: string } | void>;
  // Persist a PDF the filler edited in the viewer back to its envelope.
  // Called before finalize for every document with unsaved field edits, so
  // whatever outcome finalize runs (download, sign, ...) acts on the edited
  // file. Absent = fields still render but edits are never persisted.
  onSaveEnvelopeFile?: (envelopeId: string, file: Blob) => Promise<any>;
}

// The Generate Documents review editor: the pdf renderer hosted in the
// full-screen overlay surface, with the finalize toolbar the action configured.
export default function DocumentViewer({
  payload,
  action,
  setShow,
  onComplete,
  onFinalize,
  onSaveEnvelopeFile
}: DocumentViewerProps) {
  const pdfApiRef = useRef<PdfViewerApi | null>(null);
  // Key of the toolbar action currently running (spinner + disable-all), or
  // null when idle. Keys: 'primary', 'draft', 'download'.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  const isExpired = useMemo(
    () => new Date(payload.expires_at).getTime() < Date.now(),
    [payload.expires_at]
  );
  const [expiredBanner, setExpiredBanner] = useState(isExpired);

  // The envelopes finalize acts on: every reviewed form document, in order.
  // Read straight off the payload rather than out of the rendered PDFs;
  // edited field values are persisted separately (saveEditedDocuments) before
  // finalize runs.
  const reviewedEnvelopes = useMemo(
    () =>
      payload.documents
        .filter((doc) => doc.envelope_id)
        // The signer id comes back only for a document the filler signs
        // themselves. Finalize needs it to open that one inline instead of
        // emailing them an invite to it.
        .map((doc) => ({
          envelopeId: doc.envelope_id as string,
          signerId: doc.signer_id ?? undefined
        })),
    [payload.documents]
  );

  // The toolbar is configured on the action: `editor_toolbar_actions` lists
  // which outcomes the filler may choose. Each button finalizes with its own
  // envelope action, so one editor session can offer e.g. Sign and Download.
  // An unconfigured editor still gets a way forward: Continue finalizes with
  // `fill`, which just returns the generated files and resumes the flow.
  const configuredToolbarActions: EditorToolbarAction[] = (
    action.editor_toolbar_actions ?? []
  ).filter((a: string) =>
    TOOLBAR_ACTION_ORDER.includes(a as EditorToolbarAction)
  );
  const orderedToolbarActions = TOOLBAR_ACTION_ORDER.filter((a) =>
    configuredToolbarActions.includes(a)
  );

  const finalizeWith = async (
    toolbarAction: EditorToolbarAction,
    busyActionKey: string
  ) => {
    setBusyKey(busyActionKey);
    setError('');
    try {
      // Persist any edited field values first, so the outcome acts on them.
      await pdfApiRef.current?.saveEditedDocuments();
      // No required-field gate here: filling fields in the editor is
      // optional — the generated documents were already completable without
      // it, so blocking on empty required fields would leave the user with no
      // way forward. Required values belong to the form step that feeds
      // generation.
      const result = await onFinalize?.({
        envelopes: reviewedEnvelopes,
        envelopeAction: TOOLBAR_ACTION_ENVELOPE_ACTION[toolbarAction],
        draft: toolbarAction === 'draft'
      });
      if (result?.status === 'error') {
        if (/expired/i.test(result.message ?? '')) setExpiredBanner(true);
        else setError(result.message ?? 'Something went wrong');
      } else if (closesEditor(toolbarAction, orderedToolbarActions)) {
        onComplete();
      }
      // Otherwise the outcome has run (file downloaded, field saved) and the
      // filler stays here to reach the conclusive action.
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong';
      if (/expired/i.test(message)) setExpiredBanner(true);
      else setError(message);
    } finally {
      setBusyKey(null);
    }
  };

  // Rendered left→right, so the last entry is the primary (rightmost) button.
  const toolbarActions: ToolbarAction[] = orderedToolbarActions.length
    ? orderedToolbarActions.map((toolbarAction, i) => ({
        key: toolbarAction,
        label: TOOLBAR_ACTION_LABELS[toolbarAction],
        variant:
          i === orderedToolbarActions.length - 1 ? 'primary' : 'secondary',
        onClick: () => finalizeWith(toolbarAction, toolbarAction)
      }))
    : [
        {
          key: 'primary',
          label: 'Continue',
          variant: 'primary',
          onClick: () => finalizeWith('fill', 'primary')
        }
      ];

  return (
    <OverlaySurface
      title={VIEWER_TITLE}
      onClose={() => setShow(false)}
      actions={toolbarActions}
      busyKey={busyKey}
      banners={
        <>
          {expiredBanner && (
            <AlertBanner message='This session has expired. Please close and reopen the viewer.' />
          )}
          {error && (
            <AlertBanner message={error} onDismiss={() => setError('')} />
          )}
        </>
      }
      onSurfaceKeyDown={(e) => {
        if (e.key !== 'PageDown' && e.key !== 'PageUp') return;
        // Let focused inputs/textareas handle paging keys natively.
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        pdfApiRef.current?.stepPage(e.key === 'PageDown' ? 1 : -1);
      }}
    >
      <PdfViewer
        documents={payload.documents}
        onSaveEnvelopeFile={onSaveEnvelopeFile}
        apiRef={pdfApiRef}
      />
    </OverlaySurface>
  );
}
