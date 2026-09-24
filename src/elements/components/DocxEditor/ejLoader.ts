// Syncfusion (ej2) runtime loading, split out of useDocxEditor so the
// read-only version viewer can wait for the engine and inject styles without
// pulling in the editor hook.
import { featheryDoc, featheryWindow } from '../../../utils/browser';
import { EJ2_STYLE_INTEGRITY, EJ2_STYLE_URLS } from './constants';

// Inject the Syncfusion theme CSS once (deduped across all editor instances).
const LOADED_STYLES = new Set<string>();

export function loadStyles(): void {
  const doc = featheryDoc();
  EJ2_STYLE_URLS.forEach((href) => {
    if (LOADED_STYLES.has(href)) return;
    LOADED_STYLES.add(href);
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.integrity = EJ2_STYLE_INTEGRITY[href];
    link.crossOrigin = 'anonymous';
    doc.head.appendChild(link);
  });
  loadAccentOverride();
}

// The Syncfusion tailwind3 theme's accent is indigo (--color-sf-primary
// #6366f1). Retint the primary family to the Feathery red so the editor's
// accents — context menus, primary buttons, focus rings, selection highlight,
// title bar — match the rest of the product. Applied at :root because the
// context menu renders in a portal on <body>, out of the editor's subtree.
const ACCENT_STYLE_ID = 'feathery-docx-accent';
function loadAccentOverride(): void {
  const doc = featheryDoc();
  if (doc.getElementById(ACCENT_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = ACCENT_STYLE_ID;
  style.textContent = `:root{
    --color-sf-primary:#e2626e;
    --color-sf-primary-bg-color:#e2626e;
    --color-sf-primary-bg-color-hover:#dc3a4b;
    --color-sf-primary-bg-color-focus:#dc3a4b;
    --color-sf-primary-bg-color-pressed:#c9313f;
    --color-sf-primary-outline:#e2626e;
    --color-sf-primary-border-color:#e2626e;
    --color-sf-primary-border-color-hover:#dc3a4b;
    --color-sf-primary-border-color-focus:#dc3a4b;
    --color-sf-primary-dark:#dc3a4b;
    --color-sf-primary-darker:#c9313f;
  }`;
  doc.head.appendChild(style);
}

// A conversion that never completes must not strand the editor in `loading`.
const DOCUMENT_LOAD_TIMEOUT_MS = 20000;

/**
 * Resolves true when Syncfusion finishes laying the document out. `documentChange`
 * fires exactly once per open, after open()/openAsync() has already resolved,
 * and is the only signal that the document is really on screen. A missing event
 * is a failed load, never permission to reveal the editor's blank default page.
 */
export function waitForDocumentLoad(ed: any): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const onDocumentChange = () => finish(true);
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        ed.removeEventListener?.('documentChange', onDocumentChange);
      } catch {
        /* instance already torn down */
      }
      resolve(loaded);
    };
    const timeout = setTimeout(() => finish(false), DOCUMENT_LOAD_TIMEOUT_MS);
    if (typeof ed?.addEventListener !== 'function') {
      finish(false);
      return;
    }
    try {
      ed.addEventListener('documentChange', onDocumentChange);
    } catch {
      finish(false);
    }
  });
}

/** Resolves with the global `ej` namespace once documenteditor is present, or
 *  after `timeoutMs` regardless (the caller then surfaces a load error). */
export function waitForEj(timeoutMs = 15000): Promise<any> {
  return new Promise((resolve) => {
    const done = () => (featheryWindow() as any).ej?.documenteditor;
    if (done()) return resolve((featheryWindow() as any).ej);
    const start = Date.now();
    const iv = setInterval(() => {
      if (done() || Date.now() - start > timeoutMs) {
        clearInterval(iv);
        resolve((featheryWindow() as any).ej);
      }
    }, 50);
  });
}
