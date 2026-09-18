/** Changes is Syncfusion's loaded, navigable revision collection. The separate
 * revisions array can omit text ranges that selectRevision needs. */
export function stepperRevisions(editor: any): any[] {
  const changes = editor?.revisions?.changes;
  return Array.isArray(changes) ? changes : [];
}
