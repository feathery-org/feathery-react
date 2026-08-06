/**
 * Wires a live editor surface to a BlockStore: renders store data into SFDT
 * and opens it on relevant store changes, and folds the editor's own edits
 * (content + token values) back into the store.
 *
 * The loop, exactly:
 * 1. Attach: resolve tokens, generate SFDT, open it (applying-guarded).
 * 2. Store change with origin panel/history/theme: same as (1), scroll
 *    preserved. Origin 'document' never reopens — that change came from the
 *    document itself.
 * 3. contentChange (debounced): serialize, parse, absorb against the last
 *    rendered token values. Route token edits (field writes go straight
 *    through FieldAccess; in-memory ones batch into one store.apply). Apply
 *    any absorbed block changes as a second store.apply. Re-resolve tokens;
 *    if a token's rendered value now differs from what the document shows,
 *    regenerate and reopen once — this is what moves a computed total after
 *    its input was edited in the document.
 * 4. documentChange (debounced ~100ms, applying-guarded): ownership check.
 *    Whatever loaded — openAsync's envelope source, a regenerate, anything —
 *    if the now-open document isn't ours (no fblk_ block anchors and not the
 *    exact SFDT we last opened), reassert the generated document. Catches
 *    every foreign load regardless of when it happens, unlike a one-shot
 *    "refresh after ready" that can race it.
 * 5. detach removes both listeners and unsubscribes.
 */
import { BlockStore, UpdateOrigin } from './store';
import { collectSpecs, resolveTokens, routeTokenEdit } from './tokens';
import { generateSfdt } from './sfdt/generate';
import { parseSfdt, ParsedDoc, ParsedInlineRun } from './sfdt/parse';
import { absorbDocEdits, SyncEvent } from './diff';
import { DocumentData } from './types';
import { FieldAccess } from '../documentTokens/cycleTypes';
import { valueKey } from '../documentTokens/plan';
import { parseValue } from '../documentTokens/format';

export type SyncLogEntry = {
  at: number;
  kind: 'open' | 'absorb' | 'tokenWrite' | 'recalcReopen' | 'themeApplied';
  detail: string;
};

type EditorEventName = 'contentChange' | 'documentChange';

export type EditorSurface = {
  open: (sfdt: string) => void;
  serialize: () => string;
  addEventListener: (name: EditorEventName, fn: () => void) => void;
  removeEventListener?: (name: EditorEventName, fn: () => void) => void;
  /** Scroll container, for restore after reopen. Optional. */
  scrollContainer?: () => { scrollTop: number } | null;
};

export type BlockSync = {
  detach: () => void;
  getLog: () => SyncLogEntry[];
  subscribeLog: (fn: (log: SyncLogEntry[]) => void) => () => void;
  /** Force a regenerate+open (debug panel's Apply-data button). */
  refresh: () => void;
};

/** Store-change origins that reopen the editor; 'document' is handled separately. */
const REOPEN_LOG_KIND: Record<
  'panel' | 'history' | 'theme',
  SyncLogEntry['kind']
> = {
  panel: 'open',
  history: 'open',
  theme: 'themeApplied'
};

/** Every token run currently shown in the document, by value key. */
const shownTokenTexts = (parsed: ParsedDoc): Map<string, string> => {
  const shown = new Map<string, string>();
  const visit = (runs?: ParsedInlineRun[]) => {
    for (const run of runs ?? [])
      if (run.kind === 'token') shown.set(run.key, run.text);
  };
  for (const section of parsed.sections) {
    for (const block of section) {
      visit(block.runs);
      for (const row of block.cells ?? [])
        for (const cellRuns of row) visit(cellRuns);
    }
  }
  return shown;
};

/**
 * True when routeTokenEdit will write nothing for this key: no spec, a
 * computed spec (not writable), text that fails to parse for a numeric spec,
 * or a source-backed spec with no FieldAccess to write through (`fields?.write`
 * is then a silent no-op). routeTokenEdit itself returns null both for these
 * rejections and for a successful field-backed write, so the caller has to
 * know which before logging 'tokenWrite'.
 */
const isRejectedTokenEdit = (
  specs: ReturnType<typeof collectSpecs>,
  fields: FieldAccess | null,
  key: string,
  text: string
): boolean => {
  const spec = specs.find((s) => valueKey(s) === key);
  if (!spec || spec.formula) return true;
  if (spec.source && !fields) return true;
  const isTextFormat = (spec.format?.kind ?? 'text') === 'text';
  return !isTextFormat && parseValue(text) === null;
};

const summarizeEvents = (events: SyncEvent[]): string => {
  const counts = { blockChanged: 0, blockDeleted: 0, blockAdopted: 0 };
  for (const event of events) {
    if (event.type === 'blockChanged') counts.blockChanged += 1;
    else if (event.type === 'blockDeleted') counts.blockDeleted += 1;
    else if (event.type === 'blockAdopted') counts.blockAdopted += 1;
  }
  return `${counts.blockChanged} changed, ${counts.blockAdopted} adopted, ${counts.blockDeleted} deleted`;
};

export const attachBlockSync = (
  editor: EditorSurface,
  store: BlockStore,
  fields: FieldAccess | null,
  debounceMs = 400
): BlockSync => {
  let applying = false;
  let lastRendered = new Map<string, string>();
  // ponytail: exact-string short-circuit, not a request token — covers the
  // "editor fires contentChange after open() already returned" case that
  // the `applying` boolean (sync-only) misses. Upgrade to a request-id
  // scheme if editors start firing contentChange with content that legitimately
  // matches-by-coincidence but should still be absorbed (not expected here).
  let lastOpenedSfdt = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const log: SyncLogEntry[] = [];
  const logListeners = new Set<(entries: SyncLogEntry[]) => void>();

  const appendLog = (kind: SyncLogEntry['kind'], detail: string) => {
    log.push({ at: Date.now(), kind, detail });
    logListeners.forEach((fn) => fn(log.slice()));
  };

  /** Render the store's current data and open it, guarding the resulting contentChange. */
  const openCurrentData = () => {
    const data = store.getData();
    const { rendered } = resolveTokens(data, fields);
    lastRendered = rendered;
    const sfdt = generateSfdt(data, rendered);
    lastOpenedSfdt = sfdt;
    applying = true;
    try {
      editor.open(sfdt);
    } finally {
      applying = false;
    }
  };

  const reopenPreservingScroll = (
    kind: SyncLogEntry['kind'],
    detail: string
  ) => {
    const before = editor.scrollContainer?.() ?? null;
    openCurrentData();
    const after = before ? editor.scrollContainer?.() ?? null : null;
    if (before && after) after.scrollTop = before.scrollTop;
    appendLog(kind, detail);
  };

  const absorbEditorContent = () => {
    timer = null;
    const serialized = editor.serialize();
    // A real editor can fire contentChange asynchronously after open()
    // already returned, past the point where `applying` still guards it.
    // Cheap short-circuit: if nothing changed since we last opened, skip
    // the parse+resolve pass entirely.
    if (serialized === lastOpenedSfdt) return;

    const prevData = store.getData();
    const parsed = parseSfdt(serialized);
    const result = absorbDocEdits(prevData, parsed, lastRendered);

    const specs = collectSpecs(prevData);
    const mutations: Array<(d: DocumentData) => DocumentData> = [];
    for (const [key, text] of result.tokenEdits) {
      if (isRejectedTokenEdit(specs, fields, key, text)) continue;
      const mutation = routeTokenEdit(prevData, fields, key, text);
      if (mutation) mutations.push(mutation);
      appendLog('tokenWrite', `${key} -> ${text}`);
    }

    const blockEvents = result.events.filter(
      (event) => event.type !== 'tokenEdited'
    );
    if (blockEvents.length > 0) {
      store.apply(() => result.data, 'document');
      appendLog('absorb', summarizeEvents(blockEvents));
    }
    if (mutations.length > 0) {
      store.apply(
        (d) => mutations.reduce((acc, mutate) => mutate(acc), d),
        'document'
      );
    }

    // A token's rendered value may have moved (e.g. a computed total after
    // its input changed) without the document itself reflecting it yet.
    const shown = shownTokenTexts(parsed);
    const { rendered: freshRendered } = resolveTokens(store.getData(), fields);
    const moved = [...shown].find(
      ([key, text]) => freshRendered.get(key) !== text
    );
    if (moved) {
      const [key, text] = moved;
      reopenPreservingScroll(
        'recalcReopen',
        `${key}: ${text} -> ${freshRendered.get(key)}`
      );
    }
  };

  const onContentChange = () => {
    if (applying) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(absorbEditorContent, debounceMs);
  };

  // Ownership-by-observation: whatever loaded a document (openAsync, a
  // regenerate, anything else the host does), if what's now open isn't ours,
  // reassert. This doesn't care WHEN the foreign load happened, so it isn't
  // racing openAsync's timing the way a one-shot "refresh after ready" would.
  let documentChangeTimer: ReturnType<typeof setTimeout> | null = null;
  const checkOwnership = () => {
    documentChangeTimer = null;
    if (applying) return;
    const serialized = editor.serialize();
    if (serialized === lastOpenedSfdt || serialized.includes('"fblk_')) return;
    reopenPreservingScroll('open', 'reassert after foreign document');
  };
  const onDocumentChange = () => {
    if (applying) return;
    if (documentChangeTimer !== null) clearTimeout(documentChangeTimer);
    // Light debounce: the editor can fire documentChange mid-open, before
    // serialize() reflects the final loaded content.
    documentChangeTimer = setTimeout(checkOwnership, 100);
  };

  const unsubscribe = store.subscribe((_data, origin: UpdateOrigin) => {
    if (origin === 'document') return;
    reopenPreservingScroll(REOPEN_LOG_KIND[origin], `store change (${origin})`);
  });

  editor.addEventListener('contentChange', onContentChange);
  editor.addEventListener('documentChange', onDocumentChange);

  openCurrentData();
  appendLog('open', 'initial attach');

  return {
    detach: () => {
      if (timer !== null) clearTimeout(timer);
      if (documentChangeTimer !== null) clearTimeout(documentChangeTimer);
      editor.removeEventListener?.('contentChange', onContentChange);
      editor.removeEventListener?.('documentChange', onDocumentChange);
      unsubscribe();
    },
    getLog: () => log.slice(),
    subscribeLog: (fn) => {
      logListeners.add(fn);
      return () => logListeners.delete(fn);
    },
    refresh: () => reopenPreservingScroll('open', 'manual refresh')
  };
};
