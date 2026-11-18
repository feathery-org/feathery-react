import React, { useCallback, useMemo, useRef, useState } from 'react';
import DocxEditor from '../DocxEditor';
import EditorPreview from './EditorPreview';
import DocumentTabs from './DocumentTabs';
import DocxDocumentPacket from './DocxDocumentPacket';
import PptxDocumentPacket from './PptxDocumentPacket';
import { useDocumentPacket } from './useDocumentPacket';
import {
  EDITOR_PLACEHOLDER_ERROR_COLOR,
  EDITOR_PLACEHOLDER_STYLE
} from './placeholderStyle';
import FeatheryClient from '../../../utils/featheryClient';
import { initState } from '../../../utils/init';
import internalState from '../../../utils/internalState';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import {
  buildDocumentReviewTrigger,
  editorContainerId
} from '../../../utils/document';

// The container carries no document. Its document is owned by the Generate
// Documents button that targets it: find the action whose editor_mode matches
// this container. The schema key it was found under
// is the form key, which the DocuSign finalize needs — the `formId` prop is a
// form *instance* id and can't stand in for it.
function resolveTargetAction(containerId?: string): {
  action?: Record<string, any>;
  formKey?: string;
  buttonId?: string;
} {
  if (!containerId) return {};
  const schemas = (initState as any).formSchemas ?? {};
  for (const key of Object.keys(schemas)) {
    const rawSteps = schemas[key]?.steps;
    // panel/v20 caches steps as an array; some callers store a key→step map.
    const steps = Array.isArray(rawSteps)
      ? rawSteps
      : Object.values(rawSteps ?? {});
    for (const step of steps as any[]) {
      for (const button of step?.buttons ?? []) {
        for (const action of button?.properties?.actions ?? []) {
          if (
            action?.type === ACTION_GENERATE_ENVELOPES &&
            editorContainerId(action ?? {}) === containerId
          ) {
            return { action, formKey: key, buttonId: button.id };
          }
        }
      }
    }
  }
  return {};
}

const placeholder = EDITOR_PLACEHOLDER_STYLE;

type WrapStyle = {
  width: string;
  height: string;
  minWidth: number;
  minHeight: number | string;
  overflow: string;
  position: 'relative';
  aspectRatio?: string;
};

const wrap: WrapStyle = {
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  position: 'relative'
};

// The pptx editor fills its container absolutely (no intrinsic height); the
// aspect-ratio keeps a content-sized host from collapsing it to 0.
const editorWrap: WrapStyle = { ...wrap, aspectRatio: '16 / 10' };

const isPptx = (envelope?: { type?: string } | null) =>
  envelope?.type === 'pptx';

// A container whose content is a document editor bound to a Document template.
// It loads the packet of generated envelopes, then hands DOCX/PDF tabs to
// DocxDocumentPacket and PowerPoint tabs to PptxDocumentPacket.
export default function DocumentEditorContainer({
  containerId,
  formId,
  stepId,
  editMode,
  previewType,
  assistantEnabled
}: {
  containerId?: string;
  formId?: string;
  stepId?: string;
  editMode?: boolean;
  previewType?: 'docx' | 'pptx' | 'generic';
  assistantEnabled?: boolean;
}) {
  const {
    action: targetAction,
    formKey,
    buttonId
  } = useMemo(() => resolveTargetAction(containerId), [containerId]);
  // Carries the form key because the DocuSign sign path posts form_key; the
  // other envelope calls only need initInfo().
  const client = useMemo(() => new FeatheryClient(formKey ?? ''), [formKey]);
  const beforeReplaceRef = useRef<(() => Promise<unknown>) | null>(null);
  const registerBeforeReplace = useCallback(
    (save: (() => Promise<unknown>) | null) => {
      beforeReplaceRef.current = save;
    },
    []
  );
  const beforeReplace = useCallback(
    () => beforeReplaceRef.current?.() ?? Promise.resolve(),
    []
  );
  const loadCurrentEnvelope = useCallback(
    (id: string) => client.getCurrentEnvelope(id),
    [client]
  );
  const packet = useDocumentPacket({
    containerId,
    documents: targetAction?.documents,
    editMode,
    load: loadCurrentEnvelope,
    beforeReplace,
    // Visited DOCX tabs and decks stay mounted, so only a switch between the
    // two packets (which unmounts one) has to save first.
    saveOnSwitch: (current, next) => isPptx(current) !== isPptx(next)
  });
  const {
    tabs,
    activeId,
    envelope,
    loading,
    switching,
    error,
    operationError,
    setOperationError,
    reloadKey,
    selectTab,
    updateTabEnvelope,
    resolveEnvelopes,
    resolveTabEnvelope
  } = packet;
  const [packetBusy, setPacketBusy] = useState(false);

  // A deck's Save / Download has no finalize to report document_review, so the
  // container reports the same trigger from its own toolbar.
  const fireReviewAction = useCallback(
    (envelopeAction: string, result?: Record<string, any> | null) => {
      if (!envelope) return;
      internalState[formId ?? '']?.runDocumentReviewLogic?.(
        buildDocumentReviewTrigger({
          action: targetAction ?? {},
          elementId: containerId ?? '',
          envelopes: [{ envelopeId: envelope.id }],
          envelopeAction,
          draft: false,
          result
        })
      );
    },
    [envelope, formId, targetAction, containerId]
  );

  const tabListId = `documents-${containerId ?? 'editor'}`;
  const box = (child: React.ReactNode, style: WrapStyle = wrap) => {
    const showTabs = tabs.length > 1;
    return (
      <div css={{ ...style, display: 'flex', flexDirection: 'column' }}>
        {showTabs && (
          <DocumentTabs
            tabs={tabs}
            activeId={activeId}
            disabled={loading || switching || packetBusy}
            onSelect={selectTab}
            id={tabListId}
          />
        )}
        {operationError && (
          <div role='alert' css={{ color: '#b42318', padding: 8 }}>
            {operationError}
          </div>
        )}
        <div
          role={showTabs ? 'tabpanel' : undefined}
          id={`${tabListId}-panel`}
          aria-labelledby={
            showTabs
              ? `${tabListId}-tab-${tabs.findIndex(
                  (tab) => tab.id === activeId
                )}`
              : undefined
          }
          css={{
            flex: 1,
            minHeight: 0,
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          {child}
        </div>
      </div>
    );
  };

  if (editMode) {
    if (!previewType || previewType === 'docx')
      return box(<DocxEditor preview hideDownload />);
    return box(
      <EditorPreview type={previewType} />,
      previewType === 'pptx' ? editorWrap : wrap
    );
  }
  if (isPptx(envelope) && envelope?.file) {
    return box(
      <PptxDocumentPacket
        tabs={tabs}
        activeId={activeId}
        reloadKey={reloadKey}
        client={client}
        action={targetAction}
        containerId={containerId}
        formId={formId}
        updateEnvelope={updateTabEnvelope}
        resolveTabEnvelope={resolveTabEnvelope}
        resolveEnvelopes={resolveEnvelopes}
        registerBeforeReplace={registerBeforeReplace}
        onBusy={setPacketBusy}
        onError={setOperationError}
        onReviewAction={fireReviewAction}
      />,
      editorWrap
    );
  }
  // Both only occur during the first load, before any editor is mounted.
  if (loading) return box(<div css={placeholder}>Loading document…</div>);
  if (error) {
    return box(
      <div css={{ ...placeholder, color: EDITOR_PLACEHOLDER_ERROR_COLOR }}>
        {error}
      </div>
    );
  }
  // DOCX and signed-PDF tabs: renders its own tabs, rail, and placeholders.
  return (
    <DocxDocumentPacket
      packet={packet}
      action={targetAction}
      buttonId={buttonId}
      client={client}
      containerId={containerId}
      formId={formId}
      stepId={stepId}
      assistantEnabled={assistantEnabled}
      registerBeforeReplace={registerBeforeReplace}
    />
  );
}
