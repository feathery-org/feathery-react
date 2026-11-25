// Per-copy template values for generateDocuments. Kept free of imports so
// logic-rule context code can use it without joining the client import cycle.
import type { GenerateDocumentRef } from './featheryClient/integrationClient';

type TemplateValue = string | number | boolean | null;
export type TemplateCopyValues = Record<
  string,
  TemplateValue | TemplateValue[]
>;
// generateDocuments shorthand for one copy of a template with its own values.
// Repeat it, with the same documentId, for each further copy.
export type TemplateCopyInput = {
  documentId: string;
  values: TemplateCopyValues;
  // Opaque identity for this copy; set on every copy of a template or none.
  reference?: string;
};

const isTemplateCopyInput = (doc: unknown): doc is TemplateCopyInput =>
  !!doc &&
  typeof doc === 'object' &&
  typeof (doc as any).documentId === 'string' &&
  !!(doc as any).values &&
  typeof (doc as any).values === 'object' &&
  !Array.isArray((doc as any).values);

// Folds { documentId, values } copies into one template entry per template, at
// the position of its first copy, since the backend takes all of a template's
// copies in one entry. Values are copied so later caller edits can't leak in.
export const collapseTemplateCopies = <T>(
  docs: (T | TemplateCopyInput)[]
): (T | Extract<GenerateDocumentRef, { kind: 'template' }>)[] => {
  const byTemplate = new Map<
    string,
    Extract<GenerateDocumentRef, { kind: 'template' }>
  >();
  const collapsed: (T | Extract<GenerateDocumentRef, { kind: 'template' }>)[] =
    [];
  docs.forEach((doc) => {
    if (!isTemplateCopyInput(doc)) {
      collapsed.push(doc as T);
      return;
    }
    const id = doc.documentId.toLowerCase();
    let entry = byTemplate.get(id);
    if (!entry) {
      entry = { kind: 'template', document_id: doc.documentId, values: [] };
      byTemplate.set(id, entry);
      collapsed.push(entry);
    }
    const copies = entry.values as TemplateCopyValues[];
    if ((doc.reference !== undefined) !== (entry.references !== undefined)) {
      if (copies.length) {
        throw new Error(
          'generateDocuments: set a reference on every copy of a template or none'
        );
      }
      entry.references = [];
    }
    copies.push(
      Object.fromEntries(
        Object.entries(doc.values).map(([key, value]) => [
          key,
          Array.isArray(value) ? [...value] : value
        ])
      )
    );
    if (doc.reference !== undefined) entry.references?.push(doc.reference);
  });
  return collapsed;
};
