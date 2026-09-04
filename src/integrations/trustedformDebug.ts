import { featheryDoc, featheryWindow } from '../utils/browser';

/**
 * Local approximation of what TrustedForm records for each interaction.
 *
 * TrustedForm's script cannot be inspected locally: certificates need an
 * ActiveProspect account to view, and sandbox certificates cannot be claimed.
 * This module listens for the same interactions its session replay captures
 * (clicks, focus, typing, changes, submits) and resolves each target's name the
 * way a certificate labels it, so an unnamed control shows up in the console as
 * "[unnamed div]" here before it shows up on a customer's certificate.
 *
 * The naming order follows TrustedForm's published best practices (a `name`
 * on every input/select/a/button, an `id` on every radio) and then the
 * accessible-name sources a scanner can read. Exact precedence inside their
 * script is not documented, so treat the `source` column as "what would have
 * saved this control", not as their algorithm.
 *
 * Enable with `?feathery_tf_debug` on the form URL or
 * `localStorage.feathery_tf_debug = '1'`. Everything lands on
 * `window.__featheryTrustedForm` ({ events, audit(), report(), uninstall() }).
 */

export const TF_DEBUG_FLAG = 'feathery_tf_debug';
const LOG_PREFIX = '[TrustedForm debug]';
const CONTROL_SELECTOR =
  'input, select, textarea, button, a, img, video, iframe, embed, [role="button"], [tabindex]';
// Anything carrying a name is where a click inside it gets attributed
const NAMED_SELECTOR = `${CONTROL_SELECTOR}, [name], [aria-label], [alt]`;
const LOGGED_EVENTS = ['click', 'focusin', 'input', 'change', 'submit'];
const MASK = '********';

export type NameSource =
  | 'name'
  | 'id'
  | 'alt'
  | 'label'
  | 'aria-label'
  | 'aria-labelledby'
  | 'placeholder'
  | 'text'
  | 'unnamed';

export interface ControlDescription {
  tag: string;
  type: string;
  name: string;
  source: NameSource;
  isUnnamed: boolean;
  isSensitive: boolean;
  value: string;
  element: Element;
}

export interface ControlEvent extends ControlDescription {
  event: string;
  at: number;
}

// console.table cannot render the element itself, so drop it from table rows
const tableRow = (row: ControlDescription) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'element'));

export function isTrustedFormDebugEnabled(): boolean {
  try {
    const win = featheryWindow();
    if (new URLSearchParams(win.location.search).has(TF_DEBUG_FLAG))
      return true;
    return ['1', 'true'].includes(win.localStorage?.getItem(TF_DEBUG_FLAG));
  } catch {
    return false;
  }
}

const text = (node: Element | null | undefined) =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

function labelText(el: Element): string {
  const doc = el.ownerDocument;
  if (el.id) {
    const label = doc.querySelector(`label[for="${el.id}"]`);
    if (label) return text(label);
  }
  return text(el.closest('label'));
}

function labelledByText(el: Element): string {
  const ids = el.getAttribute('aria-labelledby');
  if (!ids) return '';
  return ids
    .split(/\s+/)
    .map((id) => text(el.ownerDocument.getElementById(id)))
    .filter(Boolean)
    .join(' ');
}

function resolveName(el: Element): { name: string; source: NameSource } {
  const tag = el.tagName.toLowerCase();
  const attempts: Array<[NameSource, string]> = [
    ['name', el.getAttribute('name') ?? ''],
    ['id', el.id],
    ['alt', el.getAttribute('alt') ?? ''],
    ['label', labelText(el)],
    ['aria-label', el.getAttribute('aria-label') ?? ''],
    ['aria-labelledby', labelledByText(el)],
    ['placeholder', el.getAttribute('placeholder') ?? ''],
    ['text', tag === 'button' || tag === 'a' ? text(el) : '']
  ];
  const hit = attempts.find(([, value]) => value.trim());
  if (hit) return { source: hit[0], name: hit[1].trim() };
  return { source: 'unnamed', name: `[unnamed ${tag}]` };
}

function isSensitive(el: Element): boolean {
  // The nearest data-tf-sensitive wins, so a "false" inside a flagged
  // container un-flags that one control (TrustedForm's inverted mode)
  const flagged = el.closest('[data-tf-sensitive]');
  if (flagged) return flagged.getAttribute('data-tf-sensitive') === 'true';
  // Assumed: TrustedForm masks password inputs without being told to
  return (el as HTMLInputElement).type === 'password';
}

function rawValue(el: Element): string {
  const input = el as HTMLInputElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' && (input.type === 'checkbox' || input.type === 'radio'))
    return `${input.value}${input.checked ? ' (checked)' : ''}`;
  if (tag === 'input' || tag === 'select' || tag === 'textarea')
    return input.value ?? '';
  return input.value || text(el);
}

export function describeControl(el: Element): ControlDescription {
  const { name, source } = resolveName(el);
  const sensitive = isSensitive(el);
  const value = rawValue(el);
  return {
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type') ?? '',
    name,
    source,
    isUnnamed: source === 'unnamed',
    isSensitive: sensitive,
    value: sensitive && value ? MASK : value,
    element: el
  };
}

/**
 * Every control TrustedForm could record inside the rendered Feathery forms,
 * with the unnamed ones first so they are the first rows of the table.
 */
export function auditControls(root: ParentNode = featheryDoc()) {
  const forms = Array.from(root.querySelectorAll('form.feathery'));
  const scopes: ParentNode[] = forms.length ? forms : [root];
  const rows = scopes.flatMap((scope) =>
    Array.from(scope.querySelectorAll(CONTROL_SELECTOR)).map(describeControl)
  );
  return rows.sort((a, b) => Number(b.isUnnamed) - Number(a.isUnnamed));
}

/**
 * Resolves once `root` has gone `quietMs` without DOM mutations. The form
 * element appears before its fields render, so auditing on first sight lists
 * a handful of controls; auditing after the render settles lists them all.
 */
export function whenDomSettles(
  root: Node = featheryDoc(),
  quietMs = 400,
  maxWaitMs = 5000
): Promise<void> {
  return new Promise((resolve) => {
    let timer = setTimeout(done, quietMs);
    const deadline = setTimeout(done, maxWaitMs);
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(done, quietMs);
    });
    function done() {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(deadline);
      resolve();
    }
    observer.observe(root, { childList: true, subtree: true });
  });
}

const eventTarget = (e: Event): Element | null => {
  const target = e.target as Element | null;
  if (!target || typeof target.closest !== 'function') return null;
  const control = target.closest(CONTROL_SELECTOR);
  if (control) return control;
  if (e.type !== 'click') return null;
  // A click on a span inside a named text block or container is attributed to
  // the nearest named ancestor; one that lands on nothing named is exactly
  // what a certificate reports as "[unnamed div]", so keep the raw target
  return target.closest(NAMED_SELECTOR) ?? target;
};

export function installTrustedFormDebug() {
  const win = featheryWindow();
  if (win.__featheryTrustedForm) return win.__featheryTrustedForm;

  const doc = featheryDoc();
  const events: ControlEvent[] = [];
  // Session replay stores every keystroke; the console only needs the first
  // one per focus so a typed sentence is one line, and `change` has the value
  const typing = new WeakSet<Element>();

  const handler = (e: Event) => {
    const target = eventTarget(e);
    if (!target) return;
    if (e.type === 'input') {
      if (typing.has(target)) return;
      typing.add(target);
    }
    if (e.type === 'change') typing.delete(target);

    const record: ControlEvent = {
      ...describeControl(target),
      event: e.type,
      at: Date.now()
    };
    events.push(record);
    const style = record.isUnnamed
      ? 'color:#b91c1c;font-weight:bold'
      : 'color:#6b7280';
    console.log(
      `%c${LOG_PREFIX} ${record.event.padEnd(7)} %c${record.name}`,
      'color:#6b7280',
      style,
      {
        via: record.source,
        value: record.value,
        sensitive: record.isSensitive,
        element: record.element
      }
    );
  };

  LOGGED_EVENTS.forEach((type) => doc.addEventListener(type, handler, true));

  const api = {
    events,
    audit: (root?: ParentNode) => {
      const rows = auditControls(root);
      const unnamed = rows.filter((r) => r.isUnnamed);
      const table = rows.map(tableRow);
      if (unnamed.length)
        console.warn(
          `${LOG_PREFIX} ${unnamed.length} of ${rows.length} controls would be recorded without a name`,
          unnamed.map((r) => r.element)
        );
      else console.info(`${LOG_PREFIX} all ${rows.length} controls are named`);
      console.table(table);
      return rows;
    },
    report: () => {
      console.table(events.map(tableRow));
      return events;
    },
    uninstall: () => {
      LOGGED_EVENTS.forEach((type) =>
        doc.removeEventListener(type, handler, true)
      );
      delete win.__featheryTrustedForm;
    }
  };
  win.__featheryTrustedForm = api;
  console.info(
    `${LOG_PREFIX} recording clicks, focus, typing, changes and submits. ` +
      'window.__featheryTrustedForm.audit() lists every control and its name; .report() tables the events so far.'
  );
  return api;
}
