// Builds the in-form AssistantChat context (targets + selection) for the
// docx-editor fill surface. Kept as pure functions so the additive
// document-target logic and selection wiring are unit-testable.

import { getDocxEditor } from '../assistant/tools/docxEditorRegistry';
import { readDocxSelection } from '../assistant/tools/docxEditorBridge';
import { AssistantSelection } from '../assistant/tools/assistantToolDispatch';

export type AssistantTarget = { type: string; id: string };

// The docx_editor servar on a step, if present (fill-mode docx surface).
export const getActiveDocxServar = (activeStep: any): any =>
  (activeStep?.servar_fields ?? [])
    .map((f: any) => f?.servar)
    .find((s: any) => s?.type === 'docx_editor') ?? null;

// panel/fuser targets (existing behavior) PLUS an additive generated_document
// target when a docx_editor field is on the active step. `generated_document`
// is accepted by ai-services' hasDocumentTarget, so the client-forwarded docx
// tools mount in fill mode; without an envelope, the server-side
// searchGeneratedDocument tool stays unmounted (correct - there's no index).
export const buildAssistantTargets = (
  formId: string | undefined,
  userId: string | undefined,
  activeStep: any
): AssistantTarget[] => {
  const targets: AssistantTarget[] = [];
  if (formId) targets.push({ type: 'panel', id: formId });
  if (userId) targets.push({ type: 'fuser', id: userId });
  const docxServar = getActiveDocxServar(activeStep);
  if (docxServar) {
    targets.push({
      type: 'generated_document',
      id: docxServar.id ?? docxServar.key
    });
  }
  return targets;
};

// Current editor selection (Contract E) from the form's registered docx editor.
export const readAssistantSelection = (
  formUuid: string | undefined
): AssistantSelection | null => {
  const editor = getDocxEditor(formUuid);
  return editor ? readDocxSelection(editor) : null;
};
