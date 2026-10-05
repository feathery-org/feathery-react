const scopes = new WeakMap<object, string>();
let nextScope = 0;

export function scopeReviewAnnotations(pdfProxy: object, annotations: any[]) {
  if (!scopes.has(pdfProxy))
    scopes.set(pdfProxy, `feathery-review-${++nextScope}`);
  const scope = scopes.get(pdfProxy);
  return annotations.map((annotation) => {
    if (!annotation.fieldName) return annotation;
    // pdf.js finds siblings with document.getElementsByName(), across EVERY
    // PDF mounted in the viewer. Change only its DOM-facing name, never the
    // annotation id used to save back into this PDF's annotationStorage.
    // Backend-prepared text fields already have distinct occurrence names.
    // Keep those names intact: text edits are independent by default. Choice
    // fields retain their common group name within this document.
    return { ...annotation, fieldName: `${scope}:${annotation.fieldName}` };
  });
}
