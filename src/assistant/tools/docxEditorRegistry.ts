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
  formId?: string;
  stepId?: string;
  documentId?: string;
  envelopeId?: string;
};

// Consumers that need to react to the assistant editor appearing or changing
// (the document indexer). Replaying the current registration covers either
// lifecycle order: chat-first or editor-first.
type DocxEditorListener = (
  registration: DocxEditorRegistration | undefined
) => void;

type DocxEditorRegistry = {
  registration?: DocxEditorRegistration;
  candidates: Map<EditorInstanceId, DocxEditorRegistration>;
  supersededEditors: WeakSet<object>;
  listeners: Set<DocxEditorListener>;
};

const DEFAULT_FORM_ID = '__legacy_document_form__';
const DEFAULT_STEP_ID = '__legacy_document_step__';
let nextOrder = 0;
const registries = new Map<string, DocxEditorRegistry>();

const getRegistry = (formId?: string): DocxEditorRegistry => {
  const key = formId ?? DEFAULT_FORM_ID;
  let registry = registries.get(key);
  if (!registry) {
    registry = {
      candidates: new Map(),
      supersededEditors: new WeakSet(),
      listeners: new Set()
    };
    registries.set(key, registry);
  }
  return registry;
};

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

const selectCandidate = (
  registry: DocxEditorRegistry
): DocxEditorRegistration | undefined =>
  [...registry.candidates.values()].sort(compareCandidates)[0];

const publish = (
  registry: DocxEditorRegistry,
  next: DocxEditorRegistration | undefined
): void => {
  if (
    registry.registration?.instanceId === next?.instanceId &&
    registry.registration?.editor === next?.editor &&
    registry.registration?.stepId === next?.stepId &&
    registry.registration?.documentId === next?.documentId &&
    registry.registration?.envelopeId === next?.envelopeId
  )
    return;
  registry.registration = next;
  registry.listeners.forEach((listener) => {
    try {
      listener(registry.registration);
    } catch {
      // An assistant subscriber must never affect editor/form registration.
    }
  });
};

export const subscribeDocxEditors = (
  listener: DocxEditorListener,
  formId?: string
): (() => void) => {
  const registry = getRegistry(formId);
  registry.listeners.add(listener);
  if (registry.registration) {
    try {
      listener(registry.registration);
    } catch {
      // An assistant subscriber must never affect editor/form registration.
    }
  }
  return () => registry.listeners.delete(listener);
};

export const registerDocxEditor = (
  editorInstanceId: string | undefined,
  editor: any,
  context: DocxEditorContext = {}
): boolean => {
  if (!editor) return false;
  const registry = getRegistry(context.formId);
  if (registry.supersededEditors.has(editor)) return false;
  const resolvedInstanceId = resolveEditorInstanceId(editorInstanceId, editor);
  const next: DocxEditorRegistration = {
    instanceId: resolvedInstanceId,
    stepId: context.stepId ?? DEFAULT_STEP_ID,
    documentId: context.documentId,
    envelopeId: context.envelopeId,
    editor,
    order: registry.candidates.get(resolvedInstanceId)?.order ?? nextOrder++
  };

  if (registry.registration && registry.registration.stepId !== next.stepId) {
    // React mounts the incoming step before unmounting the outgoing one. A
    // different step is therefore a handoff, not a simultaneous-editor error.
    // Discard outgoing candidates so their late cleanup cannot resurrect or
    // clear the incoming step.
    registry.candidates.forEach((candidate) => {
      if (candidate.editor !== editor)
        registry.supersededEditors.add(candidate.editor);
    });
    registry.candidates = new Map([[resolvedInstanceId, next]]);
    publish(registry, next);
    return true;
  }

  registry.candidates.set(resolvedInstanceId, next);
  publish(registry, selectCandidate(registry));
  return true;
};

export const unregisterDocxEditor = (
  editorInstanceId: string | undefined,
  editor: any,
  formId?: string
) => {
  const registry = getRegistry(formId);
  const resolvedInstanceId = resolveEditorInstanceId(editorInstanceId, editor);
  const owned = registry.candidates.get(resolvedInstanceId);
  if (!owned || owned.editor !== editor) return;

  registry.candidates.delete(resolvedInstanceId);
  if (
    registry.registration?.instanceId === resolvedInstanceId &&
    registry.registration.editor === editor
  )
    publish(registry, selectCandidate(registry));
};

export const getActiveDocxEditorTarget = (
  formId?: string
): { type: 'generated_document'; id: string } | undefined => {
  const registration = getRegistry(formId).registration;
  return registration?.documentId
    ? { type: 'generated_document', id: registration.documentId }
    : undefined;
};

export const getActiveDocxEditorEnvelopeTarget = (
  formId?: string
): { type: 'envelope'; id: string } | undefined => {
  const registration = getRegistry(formId).registration;
  return registration?.envelopeId
    ? { type: 'envelope', id: registration.envelopeId }
    : undefined;
};

// Calls that omit a form id keep using the legacy unnamed registry. Named
// registrations are isolated by the same form instance id as internalState.
export function getDocxEditor(formId?: string): any {
  return getRegistry(formId).registration?.editor;
}

export const _clearDocxEditors = (): void => {
  registries.clear();
  nextOrder = 0;
};
