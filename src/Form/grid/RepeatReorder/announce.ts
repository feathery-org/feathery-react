/**
 * A tiny pub/sub so a deeply nested row handle can reach its form's live region
 * without threading a callback through every Subgrid layer.
 *
 * Keyed by form: a page can carry several Feathery forms, each rendering its own
 * live region, and a single shared channel would have every one of them read out
 * a drag that happened in another form.
 */
type Listener = (message: string) => void;

const listenersByForm = new Map<string, Set<Listener>>();

export function announceReorder(formId: string, message: string) {
  listenersByForm.get(formId)?.forEach((listener) => listener(message));
}

export function subscribeToReorderAnnouncements(
  formId: string,
  listener: Listener
) {
  const listeners = listenersByForm.get(formId) ?? new Set<Listener>();
  listeners.add(listener);
  listenersByForm.set(formId, listeners);

  return () => {
    listeners.delete(listener);
    if (!listeners.size) listenersByForm.delete(formId);
  };
}
