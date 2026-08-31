/**
 * A tiny pub/sub so a deeply nested row handle can reach the form's single
 * live region without threading a callback through every Subgrid layer.
 */
type Listener = (message: string) => void;

const listeners = new Set<Listener>();

export function announceReorder(message: string) {
  listeners.forEach((listener) => listener(message));
}

export function subscribeToReorderAnnouncements(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
