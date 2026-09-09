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
import { scanBindings } from '../../../../elements/components/DocxEditor/bindings/core/sfdtAdapter';

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

function makeEditor(sfdt = buildCostsFixture()): DocumentEditor {
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
  editor.open(JSON.stringify(sfdt));
  return editor;
}

function destroy(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const parsed = (editor: DocumentEditor) => JSON.parse(editor.serialize());

const textAt = (editor: DocumentEditor, anchor: string): string | undefined =>
  flattenSfdt(parsed(editor)).find((block) => block.anchor === anchor)?.text;

const indexOf = (editor: DocumentEditor) => scanBindings(parsed(editor));

const blocks = (sfdt: any) => sfdt.sections[0].blocks;

const rejectAllRevisions = (editor: DocumentEditor): void => {
  const pending = Array.from({ length: editor.revisions.length }, (_, index) =>
    editor.revisions.get(index)
  );
  for (const revision of pending.reverse()) revision.reject();
};

function scrubCloneForStyleDiff(node: any): any {
  if (Array.isArray(node)) return node.map(scrubCloneForStyleDiff);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'contentControlProperties') continue;
    if (key === 'revisionIds') continue;
    if (key === 'text') {
      out[key] = '';
      continue;
    }
    out[key] = scrubCloneForStyleDiff(value);
  }
  return out;
}

describe('duplicate_table over bound tables', () => {
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

  it('clones a bound table into an isolated namespace while preserving SFDT styling', () => {
    const before = parsed(editor);
    const sourceTable = before.sections[0].blocks[6];
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'duplicate_table', anchor: '0;6;0;0;0', rows: 'copy' }]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'duplicate_table',
      route: 'engine'
    });
    const index = indexOf(editor);
    expect(index.tables.has('expenses')).toBe(true);
    expect(index.tables.has('expenses_copy')).toBe(true);
    const source = index.tables.get('expenses')!;
    const copy = index.tables.get('expenses_copy')!;
    expect(copy.rows.map((row) => row.rowId)).toEqual([
      'expenses_copy_r1',
      'expenses_copy_r2'
    ]);
    expect(copy.rows.map((row) => row.rowId)).not.toEqual(
      source.rows.map((row) => row.rowId)
    );

    const after = parsed(editor);
    // Word renders two adjacent tables as one, so the copy is separated from its
    // source by an empty TOP-LEVEL paragraph rather than landing flush against
    // it. Both tables are block content controls; a paragraph inside either
    // wrapper would still leave the wrappers adjacent in Word.
    expect(
      after.sections[0].blocks
        .slice(6, 9)
        .map((entry: any) =>
          entry.contentControlProperties?.tag
            ? entry.contentControlProperties.tag
            : entry.inlines
            ? 'paragraph'
            : 'other'
        )
    ).toEqual(['[[table=expenses]]', 'paragraph', '[[table=expenses_copy]]']);
    const separator = after.sections[0].blocks[7];
    expect(separator.rows).toBeUndefined();
    expect(separator.blocks).toBeUndefined();
    expect(separator.inlines).toEqual([]);
    const cloneTable = after.sections[0].blocks[8];
    expect(scrubCloneForStyleDiff(cloneTable)).toEqual(
      scrubCloneForStyleDiff(sourceTable)
    );
    expect(JSON.stringify(cloneTable)).toContain('[[table=expenses_copy]]');
    expect(JSON.stringify(cloneTable)).toContain('expenses_copy_subtotal');
    expect(JSON.stringify(cloneTable)).toContain('sum(expenses_copy.amount)');
    expect(JSON.stringify(cloneTable)).not.toContain('global=');

    const editCopy = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: '0;8;1;1;0',
          text: '$600.00',
          literal: true
        }
      ]
    });
    expect(editCopy.results[0]).toMatchObject({
      ok: true,
      route: 'engine'
    });
    expect(textAt(editor, '0;6;1;1;0')).toBe('$500.00');
    expect(textAt(editor, '0;8;1;1;0')).toBe('$600.00');
    expect(textAt(editor, '0;6;5;1;0')).toBe('$1,700.00');
    expect(textAt(editor, '0;8;5;1;0')).toBe('$1,800.00');

    const editSource = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: '0;6;1;1;0',
          text: '$700.00',
          literal: true
        }
      ]
    });
    expect(editSource.results[0]).toMatchObject({
      ok: true,
      route: 'engine'
    });
    expect(textAt(editor, '0;6;1;1;0')).toBe('$700.00');
    expect(textAt(editor, '0;8;1;1;0')).toBe('$600.00');
    expect(textAt(editor, '0;6;5;1;0')).toBe('$1,900.00');
    expect(textAt(editor, '0;8;5;1;0')).toBe('$1,800.00');
  });

  it('keeps a global field shared across the copy and tracks its full dependency update as one rejectable group', () => {
    attached.dispose();
    destroy(editor);
    editor = makeEditor(buildCostsFixture({ globalTaxRate: true }));
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });

    const duplicate = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'duplicate_table', anchor: '0;6;0;0;0', rows: 'copy' }]
    });
    expect(duplicate.results[0]).toMatchObject({ ok: true, route: 'engine' });
    editor.revisions.acceptAll();
    attached.controller.flush({ mode: 'self-heal' });

    const duplicated = indexOf(editor);
    expect(duplicated.fields.get('tax_rate')).toHaveLength(3);
    expect(duplicated.fields.has('expenses_copy_tax_rate')).toBe(false);
    expect(
      duplicated.fields
        .get('tax_rate')
        ?.every((occurrence) => occurrence.def.isGlobal)
    ).toBe(true);
    expect(
      duplicated.formulas.get('expenses_copy_tax')?.[0].def.kind === 'formula'
        ? duplicated.formulas.get('expenses_copy_tax')?.[0].def.expression
        : null
    ).toBe('mul(expenses_copy_subtotal,tax_rate)');

    const beforeWrite = editor.serialize();
    const copyTax = flattenSfdt(parsed(editor)).find(
      (block) =>
        block.anchor.startsWith('0;8;') &&
        block.boundTag === '[[name=tax_rate|type=percent|del=keep|global=true]]'
    );
    expect(copyTax).toBeDefined();

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'global-tax-rate',
      edits: [
        {
          op: 'set_cell_text',
          anchor: copyTax!.anchor,
          text: '8%',
          literal: true
        },
        {
          op: 'set_cell_text',
          anchor: '0;2;0;3;0',
          text: '8%',
          literal: true
        }
      ]
    });

    expect(result.results[0]).toMatchObject({ ok: true, route: 'engine' });
    expect(result.results[0].details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('updated global identity "tax_rate" across 3')
      ])
    );
    expect(result.results[1]).toMatchObject({
      ok: true,
      route: 'engine',
      details: [
        'global identity "tax_rate" was resolved once for this change set'
      ]
    });
    expect(result.results[0].details ?? []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('independent instances')])
    );
    const updated = indexOf(editor);
    expect(updated.fields.get('tax_rate')?.map((entry) => entry.text)).toEqual([
      '8%',
      '8%',
      '8%'
    ]);
    expect(updated.formulas.get('costs_tax')?.[0].text).toBe('$624.00');
    expect(updated.formulas.get('grand_total')?.[0].text).toBe('$8,424.00');
    expect(updated.formulas.get('expenses_tax')?.[0].text).toBe('$136.00');
    expect(updated.formulas.get('expenses_total')?.[0].text).toBe('$1,836.00');
    expect(updated.formulas.get('expenses_copy_tax')?.[0].text).toBe('$136.00');
    expect(updated.formulas.get('expenses_copy_total')?.[0].text).toBe(
      '$1,836.00'
    );

    const revisions = Array.from(
      { length: editor.revisions.length },
      (_, revisionIndex) => editor.revisions.get(revisionIndex)
    );
    expect(revisions.length).toBeGreaterThan(0);
    expect(revisions.every((revision) => revision.author === 'Robin')).toBe(
      true
    );
    expect(new Set(revisions.map((revision) => revision.customData)).size).toBe(
      1
    );

    rejectAllRevisions(editor);
    attached.controller.flush({ mode: 'self-heal' });
    expect(editor.revisions.length).toBe(0);
    expect(editor.serialize()).toBe(beforeWrite);
  });

  it('refuses conflicting writes to one global identity before changing anything', () => {
    attached.dispose();
    destroy(editor);
    editor = makeEditor(buildCostsFixture({ globalTaxRate: true }));
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
    const before = editor.serialize();

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: '0;2;0;3;0',
          text: '8%',
          literal: true
        },
        {
          op: 'set_cell_text',
          anchor: '0;6;0;1;0',
          text: '9%',
          literal: true
        }
      ]
    });

    expect(result.results.map((entry) => entry.ok)).toEqual([false, false]);
    expect(result.results[1]).toMatchObject({
      route: 'engine',
      error: 'global_binding_conflicting_writes'
    });
    expect(editor.serialize()).toBe(before);
  });

  it('creates one rejectable structural revision for a bound table duplicate', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'bound-duplicate-review',
      edits: [{ op: 'duplicate_table', anchor: '0;6;0;0;0', rows: 'copy' }]
    });

    expect(result.results[0]).toMatchObject({ ok: true, route: 'engine' });
    expect(editor.revisions.length).toBeGreaterThan(0);
    expect(
      Array.from({ length: editor.revisions.length }, (_, index) =>
        editor.revisions.get(index)
      ).every(
        (revision) =>
          revision.author === 'Robin' && revision.revisionType === 'Insertion'
      )
    ).toBe(true);
    expect(indexOf(editor).tables.has('expenses_copy')).toBe(true);

    rejectAllRevisions(editor);
    attached.controller.flush({ mode: 'self-heal' });

    expect(editor.revisions.length).toBe(0);
    expect(indexOf(editor).tables.has('expenses_copy')).toBe(false);
    expect(editor.serialize()).toBe(before);
  });

  it('writes every independent instance only after an explicit all choice', () => {
    const duplicate = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'duplicate_table', anchor: '0;6;0;0;0', rows: 'copy' }]
    });
    expect(duplicate.results[0].ok).toBe(true);
    const copyTax = flattenSfdt(parsed(editor)).find((block) =>
      block.boundTag?.includes('name=expenses_copy_tax_rate')
    );
    expect(copyTax).toBeDefined();

    const ambiguous = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: copyTax!.anchor,
          text: '8%',
          literal: true
        }
      ]
    });

    expect(ambiguous.results[0]).toMatchObject({
      ok: false,
      route: 'engine',
      error: 'independent_binding_instances_ambiguous',
      ambiguity: {
        kind: 'binding_write',
        field: 'tax_rate',
        instanceCount: 2,
        occurrenceCount: 3,
        instances: expect.arrayContaining([
          expect.objectContaining({ instanceId: 'tax_rate' }),
          expect.objectContaining({ instanceId: 'expenses_copy_tax_rate' })
        ])
      }
    });
    expect(editor.serialize()).not.toContain('8%');

    const ambiguity = ambiguous.results[0].ambiguity!;
    expect(
      ambiguity.instances
        .flatMap((instance) => instance.occurrences)
        .map((occurrence) => occurrence.tableId)
        .sort()
    ).toEqual(['costs', 'expenses', 'expenses_copy']);

    // Cross-repo contract pin. ai-services re-declares this payload as Zod in
    // `src/modules/assistant/schema.ts` and parses it, so an added, renamed, or
    // dropped key here is a breaking wire change even though nothing in this
    // repo would fail. Keep this list and that schema in step, and note that
    // occurrences carry no `anchor`: the original write's anchor identifies the
    // ambiguous family and `instanceId` selects the instance.
    expect(
      Object.keys(ambiguity.instances[0]).sort()
    ).toEqual(['identity', 'instanceId', 'occurrences']);
    for (const occurrence of ambiguity.instances.flatMap(
      (instance) => instance.occurrences
    )) {
      expect(Object.keys(occurrence).sort()).toEqual(
        [
          'bindingId',
          'documentPath',
          'location',
          'occurrenceId',
          'value',
          ...(occurrence.tableId === undefined ? [] : ['tableId'])
        ].sort()
      );
    }
    const stale = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: copyTax!.anchor,
          text: '8%',
          literal: true,
          bindingResolution: {
            ambiguityId: `${ambiguity.ambiguityId}:stale`,
            choice: 'all'
          }
        }
      ]
    });
    expect(stale.results[0]).toMatchObject({
      ok: false,
      error: 'independent_binding_instances_ambiguous',
      ambiguity: { ambiguityId: ambiguity.ambiguityId }
    });

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: copyTax!.anchor,
          text: '8%',
          literal: true,
          bindingResolution: {
            ambiguityId: ambiguity.ambiguityId,
            choice: 'all'
          }
        }
      ]
    });

    expect(result.results[0]).toMatchObject({ ok: true, route: 'engine' });
    expect(result.results[0].details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('user confirmed all 2 independent instances')
      ])
    );
    expect(
      indexOf(editor)
        .fields.get('tax_rate')
        ?.map((entry) => entry.text)
    ).toEqual(['8%', '8%']);
    expect(
      indexOf(editor)
        .fields.get('expenses_copy_tax_rate')
        ?.map((entry) => entry.text)
    ).toEqual(['8%']);
  });

  it('applies the chosen independent instance while reusing the original anchor', () => {
    const duplicate = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'duplicate_table', anchor: '0;6;0;0;0', rows: 'copy' }]
    });
    expect(duplicate.results[0].ok).toBe(true);
    const copyTax = flattenSfdt(parsed(editor)).find((block) =>
      block.boundTag?.includes('name=expenses_copy_tax_rate')
    );
    const before = editor.serialize();

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'replace_text',
          anchor: copyTax!.anchor,
          find: '0%',
          replace: '8%'
        }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: false,
      route: 'engine',
      error: 'independent_binding_instances_ambiguous',
      message: expect.stringContaining('2 independent binding instances')
    });
    expect(result.results[0].details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('table "costs"'),
        expect.stringContaining('table "expenses_copy"')
      ])
    );
    expect(editor.serialize()).toBe(before);

    const ambiguity = result.results[0].ambiguity!;
    const resolved = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: copyTax!.anchor,
          text: '8%',
          literal: true,
          bindingResolution: {
            ambiguityId: ambiguity.ambiguityId,
            choice: 'one',
            instanceId: 'tax_rate'
          }
        }
      ]
    });
    expect(resolved.results[0]).toMatchObject({
      ok: true,
      route: 'engine',
      details: ['user confirmed only binding instance "tax_rate"']
    });
    expect(
      indexOf(editor)
        .fields.get('tax_rate')
        ?.map((entry) => entry.text)
    ).toEqual(['8%', '8%']);
    expect(
      indexOf(editor)
        .fields.get('expenses_copy_tax_rate')
        ?.map((entry) => entry.text)
    ).toEqual(['0%']);
  });

  it('materializes replacement rows through the engine and recomputes formulas', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'duplicate_table',
          anchor: '0;2;0;0;0',
          rows: [
            { item: 'Hosting', quantity: '12', unit_cost: '$25.00' },
            { item: 'Support', quantity: '6', unit_cost: '$80.00' }
          ],
          literal: true
        }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'duplicate_table',
      route: 'engine'
    });
    expect(indexOf(editor).tables.has('costs_copy')).toBe(true);
    expect(result.results[0].anchor).toBe('0;4');
    expect(textAt(editor, '0;4;1;0;0')).toBe('Hosting');
    expect(textAt(editor, '0;4;1;3;0')).toBe('$300.00');
    expect(textAt(editor, '0;4;2;0;0')).toBe('Support');
    expect(textAt(editor, '0;4;2;3;0')).toBe('$480.00');
    expect(textAt(editor, '0;4;3;1;0')).toBe('$780.00');
    expect(textAt(editor, '0;4;5;1;0')).toBe('$780.00');
  });

  it('refuses numeric replacement rows without provenance before cloning', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'duplicate_table',
          anchor: '0;2;0;0;0',
          rows: [{ item: 'Hosting', quantity: '12', unit_cost: '$25.00' }]
        }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: false,
      op: 'duplicate_table',
      route: 'engine',
      error: 'model_authored_number'
    });
    expect(editor.serialize()).toBe(before);
  });

  it('refuses multiple duplicate_table ops or later anchored ops in one batch', () => {
    const multiple = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'duplicate_table', anchor: '0;2;0;0;0', rows: 'copy' },
        { op: 'duplicate_table', anchor: '0;6;0;0;0', rows: 'copy' }
      ]
    });
    expect(multiple.results[0].error).toBe(
      'duplicate_table_one_per_change_set'
    );

    // RE-POINTED, not deleted. This used to assert
    // `duplicate_table_must_end_change_set` - that a duplicate had to be the
    // last anchored edit in its change set. That refusal was replaced by the
    // resolution law (see detectBatchedDuplicateTables and
    // anchorResolutionLaw.spec.ts), so the case it guarded now SUCCEEDS, and
    // this row proves the replacement rather than disappearing with the guard.
    const laterAnchored = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'duplicate_table', anchor: '0;2;0;0;0', rows: 'copy' },
        {
          op: 'replace_text',
          anchor: '0;0',
          find: 'Project',
          replace: 'Plan'
        }
      ]
    });
    expect(laterAnchored.results.map((entry: any) => entry.error)).toEqual([
      undefined,
      undefined
    ]);
    // The edit landed where it was aimed. `0;0` is a paragraph ABOVE the
    // insertion point, so the duplicate does not move it - which is the
    // easiest half of the law and the half a stale-anchor bug would still get
    // right. The harder half, an unbound target BELOW the insertion, is clause
    // 2 of the law and is deliberately not claimed here.
    //
    // Read across ALL the paragraph's inlines, not inlines[0]: replace_text is
    // TRACKED, so the original run survives as a pending deletion beside the
    // inserted one until the change is accepted. Asserting on inlines[0] reads
    // the old text and looks like the edit never happened.
    const firstBlockText = (
      JSON.parse(editor.serialize()).sections[0].blocks[0].inlines ?? []
    )
      .map((inline: any) => inline.text ?? '')
      .join('');
    expect(firstBlockText).toContain('Plan');
  });
});
