// Lets code that holds an editor ask for a reconcile without knowing anything
// about the binding engine.
//
// The assistant is the caller that needs this. Its edits are ordinary
// user-origin edits as far as bindings are concerned, and some of them change
// what formulas depend on - inserting a row into a configured table is the clear
// case, since an unbound row has to be adopted before its formulas mean
// anything. Left to the user's next commit, the document would sit inconsistent
// in between.
//
// Keyed by the editor instance in a WeakMap, so a torn-down editor takes its
// registration with it even if dispose never runs.

const reconcilers = new WeakMap<object, () => void>();

export function registerBindingReconciler(
  editor: object,
  reconcile: () => void
): void {
  reconcilers.set(editor, reconcile);
}

export function unregisterBindingReconciler(editor: object): void {
  reconcilers.delete(editor);
}

/**
 * Reconcile this editor's bindings, if it has any. Returns whether one ran, and
 * never throws: a failed reconcile must not turn into a failed assistant edit.
 */
export function reconcileBoundDocument(editor: unknown): boolean {
  if (!editor || typeof editor !== 'object') return false;
  const reconcile = reconcilers.get(editor as object);
  if (!reconcile) return false;
  try {
    reconcile();
    return true;
  } catch (error) {
    console.error('Feathery: reconciling document bindings failed', error);
    return false;
  }
}
