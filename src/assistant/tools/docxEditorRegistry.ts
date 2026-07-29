// Runtime registry for DocumentEditorContainer's live SyncFusion editor.
// The assistant bridge stays SyncFusion-free and resolves this opaque instance
// only when a document tool is called.
type EditorInstanceId = string | object;

export type DocxEditorRegistration = {
  instanceId: EditorInstanceId;
  stepId: string;
  documentId?: string;
  envelopeId?: string;
  editor: any;
  order: number;
};

export type DocxEditorContext = {
  stepId?: string;
  documentId?: string;
  envelopeId?: string;
};

const DEFAULT_STEP_ID = '__legacy_document_step__';
let nextOrder = 0;
let registration: DocxEditorRegistration | undefined;
let candidates = new Map<EditorInstanceId, DocxEditorRegistration>();
const supersededEditors = new Set<any>();

const resolveEditorInstanceId = (
  editorInstanceId: string | undefined,
  editor: any
): EditorInstanceId => editorInstanceId ?? editor;

// One step may render several editors. They all remain mounted and usable, but
// Robin needs exactly one target. Stable container ids sort before anonymous
// instances, then lexical container order makes the winner independent of
// React effect/mount order and therefore predictable from the schema.
const compareCandidates = (
  left: DocxEditorRegistration,
  right: DocxEditorRegistration
): number => {
  if (
    typeof left.instanceId === 'string' &&
    typeof right.instanceId === 'string'
  )
    return left.instanceId.localeCompare(right.instanceId);
  if (typeof left.instanceId === 'string') return -1;
  if (typeof right.instanceId === 'string') return 1;
  return left.order - right.order;
};

const selectCandidate = (): DocxEditorRegistration | undefined =>
  [...candidates.values()].sort(compareCandidates)[0];

// Consumers that need to react to the assistant editor appearing or changing
// (the document indexer). Replaying the current registration covers either
// lifecycle order: chat-first or editor-first.
type DocxEditorListener = (
  registration: DocxEditorRegistration | undefined
) => void;
const listeners = new Set<DocxEditorListener>();

const publish = (next: DocxEditorRegistration | undefined): void => {
  if (
    registration?.instanceId === next?.instanceId &&
    registration?.editor === next?.editor &&
    registration?.stepId === next?.stepId &&
    registration?.documentId === next?.documentId &&
    registration?.envelopeId === next?.envelopeId
  )
    return;
  registration = next;
  listeners.forEach((listener) => {
    try {
      listener(registration);
    } catch {
      // An assistant subscriber must never affect editor/form registration.
    }
  });
};

export const subscribeDocxEditors = (
  listener: DocxEditorListener
): (() => void) => {
  listeners.add(listener);
  if (registration) {
    try {
      listener(registration);
    } catch {
      // An assistant subscriber must never affect editor/form registration.
    }
  }
  return () => listeners.delete(listener);
};

export const registerDocxEditor = (
  editorInstanceId: string | undefined,
  editor: any,
  context: DocxEditorContext = {}
): boolean => {
  if (!editor) return false;
  if (supersededEditors.has(editor)) return false;
  const resolvedInstanceId = resolveEditorInstanceId(editorInstanceId, editor);
  const next: DocxEditorRegistration = {
    instanceId: resolvedInstanceId,
    stepId: context.stepId ?? DEFAULT_STEP_ID,
    documentId: context.documentId,
    envelopeId: context.envelopeId,
    editor,
    order: candidates.get(resolvedInstanceId)?.order ?? nextOrder++
  };

  if (registration && registration.stepId !== next.stepId) {
    // React mounts the incoming step before unmounting the outgoing one. A
    // different step is therefore a handoff, not a simultaneous-editor error.
    // Discard outgoing candidates so their late cleanup cannot resurrect or
    // clear the incoming step.
    candidates.forEach((candidate) => {
      if (candidate.editor !== editor) supersededEditors.add(candidate.editor);
    });
    candidates = new Map([[resolvedInstanceId, next]]);
    publish(next);
    return true;
  }

  candidates.set(resolvedInstanceId, next);
  publish(selectCandidate());
  return true;
};

export const unregisterDocxEditor = (
  editorInstanceId: string | undefined,
  editor: any
) => {
  const resolvedInstanceId = resolveEditorInstanceId(editorInstanceId, editor);
  const owned = candidates.get(resolvedInstanceId);
  if (!owned || owned.editor !== editor) return;

  candidates.delete(resolvedInstanceId);
  if (
    registration?.instanceId === resolvedInstanceId &&
    registration.editor === editor
  )
    publish(selectCandidate());
};

export const getActiveDocxEditorTarget = ():
  | { type: 'generated_document'; id: string }
  | undefined =>
  registration?.documentId
    ? { type: 'generated_document', id: registration.documentId }
    : undefined;

export const getActiveDocxEditorEnvelopeTarget = ():
  | { type: 'envelope'; id: string }
  | undefined =>
  registration?.envelopeId
    ? { type: 'envelope', id: registration.envelopeId }
    : undefined;

// Existing assistant callers pass a form instance id. It is intentionally not
// a selector: the current step's deterministic registration is authoritative.
export function getDocxEditor(editorInstanceId?: string): any;
export function getDocxEditor(): any {
  return registration?.editor;
}

export const _clearDocxEditors = (): void => {
  registration = undefined;
  candidates.clear();
  supersededEditors.clear();
  listeners.clear();
  nextOrder = 0;
};
