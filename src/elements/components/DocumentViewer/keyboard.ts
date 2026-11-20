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

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit'
]);

/** Whether dropped text would land in this element (a text input, textarea or
 * contenteditable); checkboxes and selects don't take it. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  return (
    el.tagName === 'INPUT' &&
    !NON_TEXT_INPUT_TYPES.has((el as HTMLInputElement).type)
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
