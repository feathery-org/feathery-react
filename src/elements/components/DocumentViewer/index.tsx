import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';
import DocumentCanvas from './DocumentCanvas';
import Toolbar, { ToolbarAction } from './Toolbar';
import { useActivePage, pageKey } from './useActivePage';
import { useIsNarrowViewport } from './useIsNarrowViewport';
import ViewerSidebar from './sidebar';
import AlertBanner from './AlertBanner';
import {
  featheryDoc,
  featheryWindow,
  runningInClient
} from '../../../utils/browser';
import { stepPageKey, trapTabKey, isEditableTarget } from './keyboard';

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

const MAX_PAGE_WIDTH = 900;
const CONTAINER_PADDING = 48;
const VIEWER_TITLE = 'Review Your Forms';

/** One entry of the review payload's `documents` array, exactly as the
 * backend's build_envelope_viewer_payload emits it. */
export interface ViewerDocument {
  type: 'form';
  pdf_url: string;
  // The id finalize acts on.
  envelope_id?: string;
  name?: string;
}

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
    envelopes: { envelopeId: string }[];
    envelopeAction: ReviewEnvelopeAction;
    // DocuSign sign only: save the envelope as a draft instead of sending it.
    draft: boolean;
  }) => Promise<{ status?: string; message?: string } | void>;
}

export default function DocumentViewer({
  payload,
  action,
  setShow,
  onComplete,
  onFinalize
}: DocumentViewerProps) {
  const loadedDocs = useRef<Record<string, any>>({});
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Keep the keydown listener (bound once) calling the latest setShow, which
  // the parent passes as a fresh closure on every render.
  const setShowRef = useRef(setShow);
  setShowRef.current = setShow;
  // Dedicated body-level node so the viewer renders in its own subtree and the
  // rest of the page can be made `inert` while it is open (see the portal
  // effect below).
  const portalElRef = useRef<HTMLElement | null>(null);
  if (portalElRef.current === null && runningInClient()) {
    portalElRef.current = featheryDoc().createElement('div');
  }
  // Key of the toolbar action currently running (spinner + disable-all), or
  // null when idle. Keys: 'primary', 'draft', 'download'.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
  const [pageWidth, setPageWidth] = useState(MAX_PAGE_WIDTH);

  const isExpired = useMemo(
    () => new Date(payload.expires_at).getTime() < Date.now(),
    [payload.expires_at]
  );
  const [expiredBanner, setExpiredBanner] = useState(isExpired);

  const pageEntries = useMemo(
    () =>
      payload.documents.flatMap((doc) =>
        Array.from({ length: pageCounts[doc.pdf_url] ?? 0 }, (_, i) => ({
          pdfUrl: doc.pdf_url,
          pageIndex: i,
          key: pageKey(doc.pdf_url, i)
        }))
      ),
    [payload.documents, pageCounts]
  );
  const pageOrder = useMemo(() => pageEntries.map((p) => p.key), [pageEntries]);
  const { activeKey, observePage } = useActivePage(
    scrollContainerRef,
    pageOrder
  );
  const isNarrow = useIsNarrowViewport();
  const pageEntriesRef = useRef(pageEntries);
  pageEntriesRef.current = pageEntries;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) {
        setPageWidth(Math.min(MAX_PAGE_WIDTH, width - CONTAINER_PADDING));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Mount the portal node on the document body and make every sibling `inert`
  // so assistive tech (and Tab) can't reach the form behind this modal. The
  // Tab trap alone doesn't constrain a screen reader's virtual cursor.
  useEffect(() => {
    const node = portalElRef.current;
    if (!node) return undefined;
    const body = featheryDoc().body;
    body.appendChild(node);
    const siblings = Array.from(body.children).filter(
      (c) => c !== node
    ) as HTMLElement[];
    const hadInert = siblings.map((el) => el.hasAttribute('inert'));
    siblings.forEach((el) => el.setAttribute('inert', ''));
    return () => {
      siblings.forEach((el, i) => {
        if (!hadInert[i]) el.removeAttribute('inert');
      });
      if (node.parentNode) node.parentNode.removeChild(node);
    };
  }, []);

  useEffect(() => {
    // Restore focus to whatever was focused before the viewer opened when it
    // closes, so keyboard/SR users don't get dropped onto <body>.
    const previouslyFocused = featheryDoc().activeElement as HTMLElement | null;
    containerRef.current?.focus();
    const doc = featheryDoc();
    const onKeyDown = (e: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (e.key === 'Escape') {
        if (isEditableTarget(e.target)) {
          // First Esc leaves the field; the next Esc closes the viewer.
          (e.target as HTMLElement).blur();
          return;
        }
        setShowRef.current(false);
      } else if (e.key === 'PageDown' || e.key === 'PageUp') {
        // Let focused inputs/textareas handle paging keys natively.
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        const entries = pageEntriesRef.current;
        const nextKey = stepPageKey(
          entries.map((p) => p.key),
          activeKeyRef.current,
          e.key === 'PageDown' ? 1 : -1
        );
        const target = entries.find((p) => p.key === nextKey);
        if (target) onNavigate(target.pdfUrl, target.pageIndex);
      } else if (e.key === 'Tab') {
        trapTabKey(container, e);
      }
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => {
      doc.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
    // onNavigate is stable; setShow is read via ref, so the listener binds
    // once and always calls the latest setShow.
  }, []);

  // The envelopes finalize acts on: every reviewed form document, in order.
  // Read straight off the payload rather than out of the rendered PDFs — the
  // viewer is read-only, so there are no edited values to collect.
  const reviewedEnvelopes = useMemo(
    () =>
      payload.documents
        .filter((doc) => doc.envelope_id)
        .map((doc) => ({ envelopeId: doc.envelope_id as string })),
    [payload.documents]
  );

  const onDocLoad = useCallback((pdfUrl: string, pdfProxy: any) => {
    loadedDocs.current[pdfUrl] = pdfProxy;
    setPageCounts((prev) => ({ ...prev, [pdfUrl]: pdfProxy.numPages }));
  }, []);

  const registerPageRef = useCallback(
    (pdfUrl: string, pageIndex: number, el: HTMLDivElement | null) => {
      pageRefs.current[pageKey(pdfUrl, pageIndex)] = el;
      observePage(pageKey(pdfUrl, pageIndex), el);
    },
    [observePage]
  );

  const onNavigate = useCallback((pdfUrl: string, pageIndex: number) => {
    const el = pageRefs.current[pageKey(pdfUrl, pageIndex)];
    if (!el) return;
    const reduceMotion = featheryWindow().matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }, []);

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
      // No required-field gate here: the editor is read-only for now, so a
      // document whose required fields are empty could not be completed from
      // this screen — blocking would leave the user with no way forward.
      // Required values belong to the form step that feeds generation.
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

  if (!portalElRef.current) return null;
  return createPortal(
    <div
      ref={containerRef}
      role='dialog'
      aria-modal='true'
      aria-label={VIEWER_TITLE}
      tabIndex={-1}
      css={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#f4f5f8',
        outline: 'none'
      }}
    >
      <Toolbar
        title={VIEWER_TITLE}
        onBack={() => setShow(false)}
        actions={toolbarActions}
        busyKey={busyKey}
      />
      {expiredBanner && (
        <AlertBanner message='This session has expired. Please close and reopen the viewer.' />
      )}
      {error && <AlertBanner message={error} onDismiss={() => setError('')} />}
      <div css={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ViewerSidebar
          documents={payload.documents}
          pageCounts={pageCounts}
          pdfProxies={loadedDocs.current}
          activeKey={activeKey}
          onNavigate={onNavigate}
          isNarrow={isNarrow}
        />
        <div
          ref={scrollContainerRef}
          css={{ flex: 1, overflow: 'auto', padding: 24 }}
        >
          <DocumentCanvas
            documents={payload.documents}
            pageWidth={pageWidth}
            onDocLoad={onDocLoad}
            registerPageRef={registerPageRef}
          />
        </div>
      </div>
    </div>,
    portalElRef.current
  );
}
