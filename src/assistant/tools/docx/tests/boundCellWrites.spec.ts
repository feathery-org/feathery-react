// Assistant writes aimed at content-control bindings route through the binding
// engine instead of using SyncFusion's raw range write primitive.
import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';
import {
  applyDocumentEdits,
  flattenSfdt,
  LiveEditor
} from '../syncfusionDocumentOps';
import { buildCostsFixture } from '../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import {
  attachBindings,
  AttachedBindings
} from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

if (!window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) =>
        require('crypto').randomFillSync(array)
    }
  });
}
if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

function makeEditor(): DocumentEditor {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableImageResizer: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableEditorHistory: true,
    documentEditorSettings: { optimizeSfdt: false }
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(buildCostsFixture()));
  return editor;
}

function destroy(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const tagsIn = (editor: DocumentEditor): string[] => {
  const found: string[] = [];
  const walk = (node: any): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const tag = node.contentControlProperties?.tag;
    if (typeof tag === 'string') found.push(tag);
    Object.values(node).forEach(walk);
  };
  walk(JSON.parse(editor.serialize()));
  return found;
};

const QUANTITY_CELL = '0;2;1;1;0';
const LINE_TOTAL_CELL = '0;2;1;3;0';
const LABEL_CELL = '0;2;0;0;0';

const textAt = (editor: DocumentEditor, anchor: string): string | undefined =>
  flattenSfdt(JSON.parse(editor.serialize())).find(
    (block) => block.anchor === anchor
  )?.text;

const controlByTag = (node: any, tag: string): any => {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = controlByTag(entry, tag);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  if (node.contentControlProperties?.tag === tag) return node;
  for (const value of Object.values(node)) {
    const found = controlByTag(value, tag);
    if (found) return found;
  }
  return undefined;
};

const controlByName = (node: any, name: string): any => {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = controlByName(entry, name);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  if (
    String(node.contentControlProperties?.tag ?? '').startsWith(
      `[[name=${name}|`
    )
  )
    return node;
  for (const value of Object.values(node)) {
    const found = controlByName(value, name);
    if (found) return found;
  }
  return undefined;
};

const rejectAllRevisions = (editor: DocumentEditor): void => {
  const pending = Array.from({ length: editor.revisions.length }, (_, index) =>
    editor.revisions.get(index)
  );
  for (const revision of pending.reverse()) revision.reject();
};

const liveRevisions = (editor: DocumentEditor) =>
  Array.from({ length: editor.revisions.length }, (_, index) =>
    editor.revisions.get(index)
  );

const referencedRevisionIds = (sfdt: any): Set<string> => {
  const ids = new Set<string>();
  const visit = (node: any): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.revisionIds))
      node.revisionIds.forEach((id: unknown) => ids.add(String(id)));
    Object.values(node).forEach(visit);
  };
  for (const [key, value] of Object.entries(sfdt)) {
    if (key !== 'revisions') visit(value);
  }
  return ids;
};

describe('writes aimed at a bound cell', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;

  beforeEach(() => {
    editor = makeEditor();
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
  });

  afterEach(() => {
    attached.dispose();
    destroy(editor);
  });

  it('routes set_cell_text on a bound input through the engine', () => {
    const before = tagsIn(editor).length;
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: QUANTITY_CELL,
          text: '20',
          literal: true
        }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'set_cell_text',
      route: 'engine'
    });
    expect(tagsIn(editor)).toHaveLength(before);
    expect(textAt(editor, QUANTITY_CELL)).toBe('20');
    expect(textAt(editor, LINE_TOTAL_CELL)).toBe('$3,000.00');
    const quantity = controlByTag(
      JSON.parse(editor.serialize()),
      '[[name=quantity|type=integer|row=r-1]]'
    );
    expect(quantity.inlines.map((inline: any) => inline.text)).toEqual([
      '12',
      '20'
    ]);
    expect(
      quantity.inlines.every(
        (inline: any) =>
          Array.isArray(inline.revisionIds) && inline.revisionIds.length === 1
      )
    ).toBe(true);
    expect(textAt(editor, '0;2;3;1;0')).toBe('$9,000.00');
    expect(textAt(editor, '0;4')).toBe(
      'Amount due for Website relaunch: $9,000.00.'
    );
    expect(textAt(editor, '0;8')).toBe(
      'Combined total (costs + expenses): $10,700.00.'
    );
  });

  it('creates a rejectable revision for a bound input and restores its dependents on reject', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'bound-input-review',
      edits: [
        {
          op: 'set_cell_text',
          anchor: QUANTITY_CELL,
          text: '20',
          literal: true
        }
      ]
    });

    expect(result.results[0]).toMatchObject({ ok: true, route: 'engine' });
    const revisions = liveRevisions(editor);
    expect(revisions).toHaveLength(12);
    expect(
      revisions.filter((revision) => revision.revisionType === 'Deletion')
    ).toHaveLength(6);
    expect(
      revisions.filter((revision) => revision.revisionType === 'Insertion')
    ).toHaveLength(6);
    expect(revisions.every((revision) => revision.author === 'Robin')).toBe(
      true
    );
    expect(new Set(revisions.map((revision) => revision.customData)).size).toBe(
      1
    );
    const sfdt = JSON.parse(editor.serialize());
    const quantity = controlByTag(
      sfdt,
      '[[name=quantity|type=integer|row=r-1]]'
    );
    const lineTotal = controlByName(sfdt, 'line_total');
    expect(quantity.inlines.map((inline: any) => inline.text)).toEqual([
      '12',
      '20'
    ]);
    expect(lineTotal.inlines.map((inline: any) => inline.text)).toEqual([
      '$1,800.00',
      '$3,000.00'
    ]);
    const quantityRevisionIds = quantity.inlines.flatMap(
      (inline: any) => inline.revisionIds ?? []
    );
    expect(
      sfdt.revisions
        .filter((revision: any) =>
          quantityRevisionIds.includes(revision.revisionId)
        )
        .map((revision: any) => revision.revisionType)
    ).toEqual(['Deletion', 'Insertion']);
    expect(textAt(editor, QUANTITY_CELL)).toBe('20');
    expect(textAt(editor, LINE_TOTAL_CELL)).toBe('$3,000.00');

    const authoredRevisionIds = revisions.map(
      (revision) => revision.revisionID
    );
    attached.controller.flush();
    expect(
      liveRevisions(editor).map((revision) => revision.revisionID)
    ).toEqual(authoredRevisionIds);

    rejectAllRevisions(editor);
    attached.controller.flush({ mode: 'self-heal' });

    expect(editor.revisions.length).toBe(0);
    expect(textAt(editor, QUANTITY_CELL)).toBe('12');
    expect(textAt(editor, LINE_TOTAL_CELL)).toBe('$1,800.00');
    expect(editor.serialize()).toBe(before);
  });

  it('leaves native tracking off when control returns to the user', () => {
    expect(editor.enableTrackChanges).toBe(false);
    // This used to observe tracking DURING the reopen, because an authored
    // batch was installed with `editor.open`. It is no longer reopened at all:
    // the edit applies natively so it stays undoable. The row keeps its point -
    // the user must never inherit the assistant's tracking - and now asserts
    // the stronger fact that no reopen happens, alongside the leak checks below.
    const opens: string[] = [];
    const open = editor.open.bind(editor);
    editor.open = ((sfdt: string) => {
      opens.push(sfdt);
      open(sfdt);
    }) as typeof editor.open;

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'assistant-then-user',
      edits: [
        {
          op: 'set_cell_text',
          anchor: QUANTITY_CELL,
          text: '20',
          literal: true
        }
      ]
    });

    expect(result.results[0]).toMatchObject({ ok: true, route: 'engine' });
    expect(opens).toEqual([]);
    expect(editor.enableTrackChanges).toBe(false);
    const assistantRevisionCount = editor.revisions.length;

    editor.selection.select('0;0;0', '0;0;7');
    editor.editor.insertText('Updated');

    expect(editor.enableTrackChanges).toBe(false);
    expect(editor.revisions.length).toBe(assistantRevisionCount);
    expect(
      liveRevisions(editor).every((revision) => revision.author === 'Robin')
    ).toBe(true);
  });

  it('removes revision records after their document references are consumed', () => {
    applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'orphan-cleanup',
      edits: [
        {
          op: 'set_cell_text',
          anchor: QUANTITY_CELL,
          text: '20',
          literal: true
        }
      ]
    });

    const withOrphan = JSON.parse(editor.serialize());
    withOrphan.revisions.push({
      author: 'Robin',
      date: new Date().toISOString(),
      revisionType: 'Insertion',
      revisionId: 'orphaned-robin-revision',
      customData: {
        v: 1,
        source: 'robin',
        changeSetId: 'orphan-cleanup',
        group: 'orphan-cleanup'
      }
    });
    editor.open(JSON.stringify(withOrphan));

    attached.controller.flush();

    const settled = JSON.parse(editor.serialize());
    const referenced = referencedRevisionIds(settled);
    expect(
      settled.revisions.map((revision: any) => String(revision.revisionId))
    ).toEqual(expect.arrayContaining([...referenced]));
    expect(
      settled.revisions.every((revision: any) =>
        referenced.has(String(revision.revisionId))
      )
    ).toBe(true);
    expect(JSON.stringify(settled)).not.toContain('orphaned-robin-revision');
  });

  it('collapses a superseded pending value to one pair that still rejects to the original', () => {
    const before = editor.serialize();
    const first = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'bound-value-first',
      edits: [
        {
          op: 'set_cell_text',
          anchor: QUANTITY_CELL,
          text: '20',
          literal: true
        }
      ]
    });
    expect(first.results[0]).toMatchObject({ ok: true, route: 'engine' });

    const second = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'bound-value-second',
      edits: [
        {
          op: 'set_cell_text',
          anchor: QUANTITY_CELL,
          text: '25',
          literal: true
        }
      ]
    });

    expect(second.results[0]).toMatchObject({ ok: true, route: 'engine' });
    expect(editor.revisions.length).toBe(12);
    expect(textAt(editor, QUANTITY_CELL)).toBe('25');
    expect(textAt(editor, LINE_TOTAL_CELL)).toBe('$3,750.00');
    expect(
      controlByTag(
        JSON.parse(editor.serialize()),
        '[[name=quantity|type=integer|row=r-1]]'
      ).inlines.map((inline: any) => inline.text)
    ).toEqual(['12', '25']);

    rejectAllRevisions(editor);
    attached.controller.flush({ mode: 'self-heal' });

    expect(textAt(editor, QUANTITY_CELL)).toBe('12');
    expect(textAt(editor, LINE_TOTAL_CELL)).toBe('$1,800.00');
    expect(editor.serialize()).toBe(before);
  });

  it('keeps a bound input and its dependents after accepting their shared group', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'bound-input-accept',
      edits: [
        {
          op: 'set_cell_text',
          anchor: QUANTITY_CELL,
          text: '20',
          literal: true
        }
      ]
    });

    expect(result.results[0]).toMatchObject({ ok: true, route: 'engine' });
    expect(editor.revisions.length).toBe(12);

    editor.revisions.acceptAll();
    attached.controller.flush({ mode: 'self-heal' });

    expect(editor.revisions.length).toBe(0);
    expect(textAt(editor, QUANTITY_CELL)).toBe('20');
    expect(textAt(editor, LINE_TOTAL_CELL)).toBe('$3,000.00');
    expect(textAt(editor, '0;2;3;1;0')).toBe('$9,000.00');
    expect(textAt(editor, '0;4')).toBe(
      'Amount due for Website relaunch: $9,000.00.'
    );
  });

  it('refuses numeric bound input writes without user/source provenance', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'set_cell_text', anchor: QUANTITY_CELL, text: '99' }]
    });

    expect(result.results[0]).toMatchObject({
      ok: false,
      error: 'model_authored_number',
      route: 'engine'
    });
    expect(editor.serialize()).toBe(before);
  });

  it('routes document-level input replacement through setTaggedValue', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'replace_text',
          anchor: '0;1',
          find: 'Website relaunch',
          replace: 'Mobile app'
        }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'replace_text',
      route: 'engine'
    });
    expect(textAt(editor, '0;1')).toBe(
      'Project: Mobile app    Prepared: 2026-08-11'
    );
    expect(textAt(editor, '0;4')).toBe('Amount due for Mobile app: $7,800.00.');
  });

  it('redirects formula writes to their source inputs', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_formula',
          anchor: LINE_TOTAL_CELL,
          formula: `[${QUANTITY_CELL}] * 2`
        }
      ]
    });
    const failure: any = result.results[0];
    expect(failure.error).toBe('target_is_bound_formula');
    expect(failure.route).toBe('engine');
    // No rewording of the same write can succeed, and the message says what CAN:
    // change the inputs the value is computed from.
    expect(failure.retry).toBe('never');
    expect(failure.message).toMatch(/quantity/);
    expect(failure.message).toMatch(/unit_cost/);
  });

  it('refuses an unbound cell inside a bound table, rather than writing it wrong', () => {
    // Measured, not assumed: SyncFusion counts a content control's boundary
    // markers as offset positions while the walker counts characters, so this
    // write selected three of the header's four characters and produced
    // "Line itemm". Reading these cells is exact; addressing them for a write is
    // not, until the offset model accounts for markers.
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'set_cell_text', anchor: LABEL_CELL, text: 'Line item' }]
    });

    expect(result.results[0].error).toBe('unaddressable_in_bound_document');
    expect(result.results[0].route).toBe('engine');
    expect(result.results[0].retry).toBeUndefined();
    // Refused means untouched, not half-written.
    expect(editor.serialize()).toBe(before);
  });

  it('still writes freely where no binding is involved', () => {
    // The refusal is scoped to text that shares a paragraph or a container with a
    // binding - not to bound documents wholesale. This heading is neither.
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0',
          find: 'Project cost estimate',
          replace: 'Cost estimate v2'
        }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'replace_text',
      route: 'editor'
    });
    expect(editor.serialize()).toContain('Cost estimate v2');
    expect(
      liveRevisions(editor).map((revision) => revision.revisionType)
    ).toEqual(['Deletion', 'Insertion']);
  });

  it('tracks ordinary prose beside a binding without touching the control', () => {
    const before = editor.serialize();
    const controlsBefore = tagsIn(editor);
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'prepared-date-prose',
      edits: [
        {
          op: 'replace_text',
          anchor: '0;1',
          find: 'Prepared: 2026-08-11',
          replace: 'Prepared: 2026-09-01'
        }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'replace_text',
      route: 'editor'
    });
    expect(textAt(editor, '0;1')).toBe(
      'Project: Website relaunch    Prepared: 2026-09-01'
    );
    expect(tagsIn(editor)).toEqual(controlsBefore);
    expect(
      liveRevisions(editor).map((revision) => revision.revisionType)
    ).toEqual(['Deletion', 'Insertion']);

    rejectAllRevisions(editor);
    expect(editor.serialize()).toBe(before);
  });

  it('preflights mixed editor and engine batches before either route writes', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0',
          find: 'Project cost estimate',
          replace: 'Should not land'
        },
        {
          op: 'set_cell_text',
          anchor: QUANTITY_CELL,
          text: 'twelve',
          literal: true
        }
      ]
    });

    expect(result.results.map((entry) => entry.ok)).toEqual([false, false]);
    expect(result.results[0]).toMatchObject({
      error: 'change_set_preflight_failed',
      route: 'editor'
    });
    expect(result.results[1]).toMatchObject({
      error: 'binding_value_parse_failed',
      route: 'engine'
    });
    expect(editor.serialize()).toBe(before);
  });

  it('applies mixed editor and engine batches atomically when both preflight', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0',
          find: 'Project cost estimate',
          replace: 'Cost estimate v2'
        },
        {
          op: 'set_cell_text',
          anchor: QUANTITY_CELL,
          text: '20',
          literal: true
        }
      ]
    });

    expect(result.results).toMatchObject([
      { ok: true, route: 'editor' },
      { ok: true, route: 'engine' }
    ]);
    expect(textAt(editor, '0;0')).toBe('Cost estimate v2');
    expect(textAt(editor, QUANTITY_CELL)).toBe('20');
    expect(textAt(editor, LINE_TOTAL_CELL)).toBe('$3,000.00');
  });
});
