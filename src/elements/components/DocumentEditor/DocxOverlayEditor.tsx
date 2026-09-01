import React, { useCallback, useRef, useState } from 'react';
import OverlaySurface from './OverlaySurface';
import AlertBanner from './AlertBanner';
import DocxEnvelopeEditor, {
  Envelope,
  envelopeSourceUrl
} from './DocxEnvelopeEditor';
import type FeatheryClient from '../../../utils/featheryClient';
import { featheryWindow } from '../../../utils/browser';
import { isDocxEditorDirty } from '../DocxEditor/docxDirtyRegistry';
import { color, fontSize } from './tokens';

const EDITOR_TITLE = 'Edit Your Documents';
const UNSAVED_MESSAGE =
  'You have unsaved changes in the document editor. If you leave now, your changes will be lost.';

// Registry key for an overlay-hosted editor — the same registries container
// editors use, so the assistant and the unsaved-changes guards cover both.
const overlayKey = (envelopeId: string) => `overlay:${envelopeId}`;

interface DocxOverlayEditorProps {
  envelopes: Envelope[];
  action: Record<string, any>;
  client: FeatheryClient;
  formId?: string;
  stepId?: string;
  assistantEnabled?: boolean;
  setShow: (show: boolean) => void;
  // A signing terminal action concluded: close and resume the flow.
  onComplete: () => void;
}

// The Generate Documents editor for an all-docx packet: the Syncfusion
// envelope editor hosted in the full-screen overlay surface. One document is
// mounted at a time (Syncfusion owns its own scrolling and toolbar); a packet
// with several gets a document switcher.
export default function DocxOverlayEditor({
  envelopes: initialEnvelopes,
  action,
  client,
  formId,
  stepId,
  assistantEnabled,
  setShow,
  onComplete
}: DocxOverlayEditorProps) {
  // Saves refresh an envelope's file URLs; the payload prop stays what
  // generate returned.
  const [envelopes, setEnvelopes] = useState(initialEnvelopes);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState('');
  // Source URLs pinned at open: a save refreshes envelope file URLs, and a
  // changed source would reload the document out from under the user.
  const sourcesRef = useRef<Record<string, { url: string } | undefined>>({});
  const sourceFor = (envelope: Envelope) => {
    if (!(envelope.id in sourcesRef.current)) {
      const url = envelopeSourceUrl(envelope);
      sourcesRef.current[envelope.id] = url ? { url } : undefined;
    }
    return sourcesRef.current[envelope.id];
  };

  const active = envelopes[activeIndex];

  // Unmounting a dirty editor (switch or close) discards its unsaved changes,
  // so both paths confirm first — same message the step-navigation guard uses.
  const confirmDiscard = useCallback(
    (envelopeId: string) =>
      !isDocxEditorDirty(formId, overlayKey(envelopeId)) ||
      featheryWindow().confirm(UNSAVED_MESSAGE),
    [formId]
  );

  const onEnvelopeUpdated = useCallback(
    (updated: { file: string; editor_file?: string | null }) => {
      setEnvelopes((current) =>
        current.map((env, i) =>
          i === activeIndex ? { ...env, ...updated } : env
        )
      );
    },
    [activeIndex]
  );

  if (!active) return null;
  return (
    <OverlaySurface
      title={EDITOR_TITLE}
      onClose={() => {
        if (!confirmDiscard(active.id)) return;
        setShow(false);
      }}
      // The docx editor carries its own toolbar (ribbon + terminal actions),
      // so the surface header holds just the title and Back.
      actions={[]}
      busyKey={null}
      banners={
        error ? (
          <AlertBanner message={error} onDismiss={() => setError('')} />
        ) : undefined
      }
    >
      {envelopes.length > 1 && (
        <div
          role='tablist'
          aria-label='Documents'
          css={{
            display: 'flex',
            gap: 4,
            padding: '8px 16px',
            backgroundColor: color.surface,
            borderBottom: `1px solid ${color.border}`,
            overflowX: 'auto',
            flexShrink: 0
          }}
        >
          {envelopes.map((envelope, i) => (
            <button
              key={envelope.id}
              type='button'
              role='tab'
              aria-selected={i === activeIndex}
              onClick={() => {
                if (i === activeIndex || !confirmDiscard(active.id)) return;
                setError('');
                setActiveIndex(i);
              }}
              css={{
                border: 'none',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: fontSize.base,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                backgroundColor:
                  i === activeIndex ? color.surfaceHover : 'transparent',
                color: color.text,
                fontWeight: i === activeIndex ? 600 : 400
              }}
            >
              {envelope.key || `Document ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <div css={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <DocxEnvelopeEditor
          key={active.id}
          envelope={active}
          action={action}
          client={client}
          source={sourceFor(active)}
          registryKey={overlayKey(active.id)}
          formId={formId}
          stepId={stepId}
          assistantEnabled={assistantEnabled}
          defaultDocumentId={active.document}
          onEnvelopeUpdated={onEnvelopeUpdated}
          onError={setError}
          onTerminalOutcome={onComplete}
        />
      </div>
    </OverlaySurface>
  );
}
