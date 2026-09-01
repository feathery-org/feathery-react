export function stepPageKey(
  pageOrder: string[],
  activeKey: string,
  delta: 1 | -1
): string | null {
  if (!pageOrder.length) return null;
  const idx = pageOrder.indexOf(activeKey);
  const next = idx === -1 ? 0 : idx + delta;
  if (next < 0 || next >= pageOrder.length) return null;
  return pageOrder[next];
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    !!el.isContentEditable
  );
}

interface TabLikeEvent {
  shiftKey: boolean;
  preventDefault: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapTabKey(container: HTMLElement, e: TabLikeEvent): void {
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = container.ownerDocument.activeElement;
  if (e.shiftKey && (active === first || !container.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !container.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}
