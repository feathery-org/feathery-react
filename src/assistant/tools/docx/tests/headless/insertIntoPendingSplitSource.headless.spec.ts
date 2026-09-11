import {
  HeadlessSession,
  readFixture,
  shoot,
  startHeadless
} from './headlessSession';

const SOURCE = 'property_premium';
const COPY = 'property_premium_copy';

const addSignage = (source: string) => [
  {
    op: 'insert_row',
    group: 'g02-add-signage',
    anchor: `${source};5;0;0`,
    expect: ''
  },
  {
    op: 'set_cell_text',
    group: 'g02-add-signage',
    anchor: `${source};6;0;0`,
    expect: '',
    text: 'Signage'
  },
  {
    op: 'set_cell_text',
    group: 'g02-add-signage',
    anchor: `${source};6;1;0`,
    expect: '',
    text: '3',
    literal: true
  },
  {
    op: 'set_cell_text',
    group: 'g02-add-signage',
    anchor: `${source};6;2;0`,
    expect: '',
    text: '210.00',
    literal: true
  }
];

const addGlass = (copy: string) => [
  {
    op: 'insert_row',
    group: 'g02-add-glass',
    anchor: `${copy};1;0;0`,
    expect: 'Stock'
  },
  {
    op: 'set_cell_text',
    group: 'g02-add-glass',
    anchor: `${copy};2;0;0`,
    expect: '',
    text: 'Glass'
  },
  {
    op: 'set_cell_text',
    group: 'g02-add-glass',
    anchor: `${copy};2;1;0`,
    expect: '',
    text: '1',
    literal: true
  },
  {
    op: 'set_cell_text',
    group: 'g02-add-glass',
    anchor: `${copy};2;2;0`,
    expect: '',
    text: '200.00',
    literal: true
  }
];

describe('bound row operations while a source split is still pending', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  const openWithPendingSplit = async (): Promise<string> => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    const source = await session.call<string>('tableAnchor', SOURCE);
    const split = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'duplicate_table',
          group: 'g01-split-tail',
          anchor: source,
          rows: 'copy',
          resultRef: '@copy'
        },
        {
          op: 'delete_row',
          group: 'g01-split-tail',
          anchor: '@copy',
          rows: [1, 2]
        },
        {
          op: 'delete_row',
          group: 'g01-split-tail',
          anchor: `${source};3;0;0`,
          rows: [3, 4, 5]
        }
      ],
      'pending-source-split'
    );
    expect(split.outcomes).toEqual(['ok', 'ok', 'ok']);
    expect(await session.call<any[]>('groups')).toHaveLength(1);
    return source;
  };

  const openWithPendingPrimitiveSplit = async (): Promise<{
    original: string;
    source: string;
    copy: string;
  }> => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    const original = await session.call<string>('serialize');
    const source = await session.call<string>('tableAnchor', SOURCE);
    const split = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'duplicate_table',
          group: 'g01-split-tail',
          anchor: source,
          rows: 'copy',
          resultRef: '@copy'
        },
        {
          op: 'delete_row',
          group: 'g01-split-tail',
          anchor: '@copy',
          rows: [1, 2]
        },
        {
          op: 'delete_row',
          group: 'g01-split-tail',
          anchor: `${source};3;0;0`,
          rows: [3, 4, 5]
        }
      ],
      'pending-source-split'
    );
    expect(split.outcomes).toEqual(['ok', 'ok', 'ok']);
    expect(await session.call<any[]>('groups')).toHaveLength(1);
    return {
      original,
      source,
      copy: await session.call<string>('tableAnchor', COPY)
    };
  };

  it('restripes and exactly rejects an ordinary mid-table insertion', async () => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    const original = await session.call<string>('serialize');
    const source = await session.call<string>('tableAnchor', SOURCE);
    const edits = [
      {
        op: 'insert_row',
        group: 'g01-add-signage',
        anchor: `${source};2;0;0`,
        expect: 'Contents'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-signage',
        anchor: `${source};3;0;0`,
        expect: '',
        text: 'Signage'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-signage',
        anchor: `${source};3;1;0`,
        expect: '',
        text: '3',
        literal: true
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-signage',
        anchor: `${source};3;2;0`,
        expect: '',
        text: '210.00',
        literal: true
      }
    ];
    const inserted = await session.call<any>(
      'applyEdits',
      edits,
      'ordinary-source-insert'
    );
    expect(inserted.outcomes).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(inserted.warnings).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/left unbanded/)])
    );
    expect(
      await session.call<Array<string | null>>('rowShading', SOURCE)
    ).toEqual([
      '#001B49FF',
      null,
      '#E6E6E6FF',
      null,
      '#E6E6E6FF',
      null,
      '#E6E6E6FF',
      null
    ]);
    await session.call('resolveGroupsOf', 'ordinary-source-insert', false);
    expect(await session.call<string>('serialize')).toBe(original);

    expect(
      (
        await session.call<any>(
          'applyEdits',
          edits,
          'ordinary-source-insert-again'
        )
      ).outcomes
    ).toEqual(['ok', 'ok', 'ok', 'ok']);
    await session.call('resolveGroups', true);
    expect(
      await session.call<Array<string | null>>('rowShading', SOURCE)
    ).toEqual([
      '#001B49FF',
      null,
      '#E6E6E6FF',
      null,
      '#E6E6E6FF',
      null,
      '#E6E6E6FF',
      null
    ]);
  }, 120000);

  it('restripes and exactly rejects an ordinary mid-table deletion', async () => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    const original = await session.call<string>('serialize');
    const source = await session.call<string>('tableAnchor', SOURCE);
    const deletion = [
      {
        op: 'delete_row',
        group: 'g01-delete-contents',
        anchor: `${source};2;0;0`,
        expect: 'Contents',
        rows: [2]
      }
    ];
    const deleted = await session.call<any>(
      'applyEdits',
      deletion,
      'ordinary-source-delete'
    );
    expect(deleted.outcomes).toEqual(['ok']);
    expect(deleted.warnings).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/left unbanded/)])
    );
    await session.call('resolveGroupsOf', 'ordinary-source-delete', false);
    expect(await session.call<string>('serialize')).toBe(original);

    expect(
      (
        await session.call<any>(
          'applyEdits',
          deletion,
          'ordinary-source-delete-again'
        )
      ).outcomes
    ).toEqual(['ok']);
    await session.call('resolveGroups', true);
    expect(
      await session.call<Array<string | null>>('rowShading', SOURCE)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, '#E6E6E6FF', null]);
  }, 120000);

  it('creates a new green row instead of writing into a struck-through row', async () => {
    const source = await openWithPendingSplit();
    const inserted = await session.call<any>(
      'applyEdits',
      addSignage(source),
      'pending-source-insert'
    );
    expect(inserted.outcomes).toEqual(['ok', 'ok', 'ok', 'ok']);

    const groups = await session.call<any[]>('groups');
    expect(groups).toHaveLength(1);
    expect(groups[0].changeSetIds.sort()).toEqual([
      'pending-source-insert',
      'pending-source-split'
    ]);
    expect(groups[0].derivedChanges).toContainEqual({
      name: 'property_premium_subtotal',
      beforeText: '$22,054.40',
      afterText: '$11,638.00'
    });

    const pendingFormulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(pendingFormulas.property_premium_subtotal).toBe('$11,638.00');
    expect(pendingFormulas.property_premium_copy_subtotal).toBe('$11,046.40');
    expect(pendingFormulas.summary_subtotal).toBe('$76,297.35');
    expect(pendingFormulas.summary_tax).toBe('$6,485.27');
    expect(pendingFormulas.grand_total).toBe('$82,782.62');

    const pendingRows = await session.call<string[]>('tableRowTexts', SOURCE);
    expect(pendingRows[3]).toBe('Signage3$210.00$630.00');
    expect(pendingRows[4]).toContain('Stock');
    expect(pendingRows[5]).toContain('Business interruption');
    expect(pendingRows[6]).toContain('Machinery breakdown');
    const pendingRowIds = await session.call<string[]>('tableRowIds', SOURCE);
    expect(new Set(pendingRowIds).size).toBe(3);
    expect(pendingRowIds).toEqual(
      expect.arrayContaining(['property-r1', 'property-r2'])
    );
    await shoot(session, 'pending-source-insert', 'Signage');

    await session.call('resolveGroups', true);
    expect(await session.call<any[]>('groups')).toHaveLength(0);
    const rows = await session.call<string[]>('tableRowTexts', SOURCE);
    expect(rows).toHaveLength(5);
    expect(rows[1]).toContain('Buildings');
    expect(rows[2]).toContain('Contents');
    expect(rows[3]).toContain('Signage');
    expect(rows.join('|')).not.toMatch(/Stock|Business interruption|Machinery/);
    expect(await session.call<string[]>('tableRowIds', SOURCE)).toHaveLength(3);
    expect(await session.call<string[]>('tableRowIds', COPY)).toHaveLength(3);
    expect(
      await session.call<Array<string | null>>('rowShading', SOURCE)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, '#E6E6E6FF']);
    expect(
      await session.call<Array<string | null>>('rowShading', COPY)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, null]);

    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulas.property_premium_subtotal).toBe('$11,638.00');
    expect(formulas.property_premium_copy_subtotal).toBe('$11,046.40');
    expect(formulas.summary_subtotal).toBe('$76,297.35');
    expect(formulas.summary_tax).toBe('$6,485.27');
    expect(formulas.grand_total).toBe('$82,782.62');
  }, 120000);

  it('rejects the added-row family back to the exact original', async () => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    const original = await session.call<string>('serialize');
    const source = await openWithPendingSplit();
    const inserted = await session.call<any>(
      'applyEdits',
      addSignage(source),
      'pending-source-insert'
    );
    expect(inserted.outcomes).toEqual(['ok', 'ok', 'ok', 'ok']);

    await session.call('resolveGroupsOf', 'pending-source-insert', false);
    expect(await session.call<any[]>('groups')).toHaveLength(0);
    expect(await session.call<string>('serialize')).toBe(original);
  }, 120000);

  it('restripes the copied table subtotal when a row is added before accepting the split', async () => {
    const { copy } = await openWithPendingPrimitiveSplit();
    const inserted = await session.call<any>(
      'applyEdits',
      addGlass(copy),
      'pending-copy-insert'
    );
    expect(inserted.outcomes).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(inserted.warnings).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/left unbanded/)])
    );
    expect((await session.call<string[]>('tableRowTexts', COPY))[2]).toBe(
      'Glass1$200.00$200.00'
    );
    expect(
      await session.call<Array<string | null>>('rowShading', COPY)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, '#E6E6E6FF', null]);

    await session.call('resolveGroups', true);
    expect(
      await session.call<Array<string | null>>('rowShading', COPY)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, '#E6E6E6FF', null]);
    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulas.property_premium_copy_subtotal).toBe('$11,246.40');
    expect(formulas.summary_subtotal).toBe('$75,867.35');
    expect(formulas.summary_tax).toBe('$6,448.72');
    expect(formulas.grand_total).toBe('$82,316.07');
  }, 120000);

  it('persists the table family across reload before a copied-table row is added', async () => {
    const { original } = await openWithPendingPrimitiveSplit();
    const pending = await session.call<string>('serialize');
    await session.call('open', pending);
    const copy = await session.call<string>('tableAnchor', COPY);
    expect(
      (
        await session.call<any>(
          'applyEdits',
          addGlass(copy),
          'pending-copy-after-reload'
        )
      ).outcomes
    ).toEqual(['ok', 'ok', 'ok', 'ok']);
    const groups = await session.call<any[]>('groups');
    expect(groups).toHaveLength(1);
    expect(groups[0].changeSetIds.sort()).toEqual([
      'pending-copy-after-reload',
      'pending-source-split'
    ]);

    await session.call('resolveGroupsOf', 'pending-copy-after-reload', false);
    expect(await session.call<any[]>('groups')).toHaveLength(0);
    expect(await session.call<string>('serialize')).toBe(original);
  }, 120000);

  it('keeps the table family after an independent paragraph shifts both table anchors', async () => {
    await openWithPendingPrimitiveSplit();
    const heading = (await session.call<any[]>('inventory')).find(
      (entry) => entry.text === '1.3 Premium Detail'
    );
    expect(heading?.anchor).toBeTruthy();
    expect(
      (
        await session.call<any>(
          'applyEdits',
          [
            {
              op: 'insert_text',
              group: 'g01-spacing',
              anchor: heading.anchor,
              position: 'after',
              text: 'Spacing checkpoint'
            }
          ],
          'independent-spacing'
        )
      ).outcomes
    ).toEqual(['ok']);
    await session.call('resolveGroupsOf', 'independent-spacing', true);

    const copy = await session.call<string>('tableAnchor', COPY);
    expect(
      (
        await session.call<any>(
          'applyEdits',
          addGlass(copy),
          'pending-copy-after-shift'
        )
      ).outcomes
    ).toEqual(['ok', 'ok', 'ok', 'ok']);
    const groups = await session.call<any[]>('groups');
    expect(groups).toHaveLength(1);
    expect(
      groups.find((group) =>
        group.changeSetIds?.includes('pending-copy-after-shift')
      )?.changeSetIds.sort()
    ).toEqual(['pending-copy-after-shift', 'pending-source-split']);

    await session.call('resolveGroupsOf', 'pending-copy-after-shift', false);
    const remaining = await session.call<any[]>('groups');
    expect(remaining).toHaveLength(0);
    expect(await session.call<string>('serialize')).toContain(
      'Spacing checkpoint'
    );
    expect(await session.call<string[]>('tableIds')).not.toContain(COPY);
    expect(
      (await session.call<Record<string, string>>('formulaValues'))
        .property_premium_subtotal
    ).toBe('$22,054.40');
  }, 120000);

  it('rejects a copied-table row family to the exact original', async () => {
    const { copy, original } = await openWithPendingPrimitiveSplit();
    expect(
      (
        await session.call<any>(
          'applyEdits',
          addGlass(copy),
          'pending-copy-insert'
        )
      ).outcomes
    ).toEqual(['ok', 'ok', 'ok', 'ok']);

    await session.call('resolveGroupsOf', 'pending-copy-insert', false);
    expect(await session.call<any[]>('groups')).toHaveLength(0);
    expect(await session.call<string>('serialize')).toBe(original);
  }, 120000);

  it('restripes after deleting from the copied table before accepting the split', async () => {
    const { copy } = await openWithPendingPrimitiveSplit();
    const deleted = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'delete_row',
          group: 'g02-delete-business',
          anchor: `${copy};2;0;0`,
          expect: 'Business interruption',
          rows: [2]
        }
      ],
      'pending-copy-delete'
    );
    expect(deleted.outcomes).toEqual(['ok']);
    expect(deleted.warnings).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/left unbanded/)])
    );
    // The full React host can deliver a late content-change event after the
    // authored transaction. Its follow-up reconcile must preserve the current
    // view of a row that was inserted by the split and then deleted by this
    // second card.
    await session.call('reconcileBindings');
    expect(
      await session.call<Array<string | null>>('rowShading', COPY)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', '#E6E6E6FF', null]);

    await session.call('resolveGroups', true);
    expect(await session.call<string[]>('tableRowTexts', COPY)).toEqual([
      'ItemUnitsRateLine total',
      'Stock15$288.40$4,326.00',
      'Machinery breakdown6$372.90$2,237.40',
      'Subsection subtotal$6,563.40'
    ]);
    expect(
      await session.call<Array<string | null>>('rowShading', COPY)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null]);
    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulas.property_premium_copy_subtotal).toBe('$6,563.40');
    expect(formulas.summary_subtotal).toBe('$71,184.35');
    expect(formulas.summary_tax).toBe('$6,050.67');
    expect(formulas.grand_total).toBe('$77,235.02');
  }, 120000);

  it('rejects a copied-table deletion family to the exact original', async () => {
    const { copy, original } = await openWithPendingPrimitiveSplit();
    expect(
      (
        await session.call<any>(
          'applyEdits',
          [
            {
              op: 'delete_row',
              group: 'g02-delete-business',
              anchor: `${copy};2;0;0`,
              expect: 'Business interruption',
              rows: [2]
            }
          ],
          'pending-copy-delete'
        )
      ).outcomes
    ).toEqual(['ok']);

    await session.call('resolveGroupsOf', 'pending-copy-delete', false);
    expect(await session.call<any[]>('groups')).toHaveLength(0);
    expect(await session.call<string>('serialize')).toBe(original);
  }, 120000);

  it('restripes after deleting from the original table before accepting the split', async () => {
    const { source } = await openWithPendingPrimitiveSplit();
    const deleted = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'delete_row',
          group: 'g02-delete-contents',
          anchor: `${source};2;0;0`,
          expect: 'Contents',
          rows: [2]
        }
      ],
      'pending-source-delete'
    );
    expect(deleted.outcomes).toEqual(['ok']);
    expect(deleted.warnings).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/left unbanded/)])
    );

    await session.call('resolveGroups', true);
    const rows = await session.call<string[]>('tableRowTexts', SOURCE);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('Buildings');
    expect(rows[2]).toContain('$7,686.00');
    expect(
      await session.call<Array<string | null>>('rowShading', SOURCE)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF']);
    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulas.property_premium_subtotal).toBe('$7,686.00');
    expect(formulas.property_premium_copy_subtotal).toBe('$11,046.40');
    expect(formulas.summary_subtotal).toBe('$72,345.35');
    expect(formulas.summary_tax).toBe('$6,149.35');
    expect(formulas.grand_total).toBe('$78,494.70');
  }, 120000);

  it('can accept the split-plus-row family and then delete the accepted row', async () => {
    const source = await openWithPendingSplit();
    expect(
      (
        await session.call<any>(
          'applyEdits',
          addSignage(source),
          'pending-source-insert'
        )
      ).outcomes
    ).toEqual(['ok', 'ok', 'ok', 'ok']);

    await session.call('resolveGroupsOf', 'pending-source-insert', true);
    let groups = await session.call<any[]>('groups');
    expect(groups).toHaveLength(0);

    const signage = (await session.call<any[]>('inventory')).find(
      (entry) => entry.text === 'Signage'
    );
    expect(signage?.anchor).toMatch(new RegExp(`^${source};\\d+;0;0$`));
    const signageRow = Number(signage.anchor.split(';')[2]);
    const deleted = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'delete_row',
          group: 'g03-delete-signage',
          anchor: signage.anchor,
          expect: 'Signage',
          rows: [signageRow]
        }
      ],
      'pending-source-delete'
    );
    expect(deleted.outcomes).toEqual(['ok']);

    groups = await session.call<any[]>('groups');
    expect(groups).toHaveLength(1);
    expect(groups[0].changeSetId).toBe('pending-source-delete');

    const pendingDeleteFormulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(pendingDeleteFormulas.property_premium_subtotal).toBe('$11,008.00');
    expect(pendingDeleteFormulas.summary_subtotal).toBe('$75,667.35');
    expect(pendingDeleteFormulas.summary_tax).toBe('$6,431.72');
    expect(pendingDeleteFormulas.grand_total).toBe('$82,099.07');

    await session.call('resolveGroupsOf', 'pending-source-delete', true);
    groups = await session.call<any[]>('groups');
    expect(groups).toHaveLength(0);
    expect(await session.call<string[]>('tableRowIds', SOURCE)).toHaveLength(2);
    expect(
      (await session.call<string[]>('tableRowTexts', SOURCE)).join('|')
    ).not.toContain('Signage');
    expect(
      await session.call<Array<string | null>>('rowShading', SOURCE)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null]);

    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulas.property_premium_subtotal).toBe('$11,008.00');
    expect(formulas.property_premium_copy_subtotal).toBe('$11,046.40');
    expect(formulas.summary_subtotal).toBe('$75,667.35');
    expect(formulas.summary_tax).toBe('$6,431.72');
    expect(formulas.grand_total).toBe('$82,099.07');
  }, 120000);

  it('moves non-contiguous rows and restripes both resulting tables', async () => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    const source = await session.call<string>('tableAnchor', SOURCE);
    expect(await session.call<number>('contentControlCount')).toBe(82);

    const split = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'duplicate_table',
          group: 'g01-split-alternating',
          anchor: source,
          rows: 'copy',
          resultRef: '@copy'
        },
        {
          op: 'delete_row',
          group: 'g01-split-alternating',
          anchor: '@copy',
          rows: [1, 3, 5]
        },
        {
          op: 'delete_row',
          group: 'g01-split-alternating',
          anchor: `${source};2;0;0`,
          rows: [2, 4]
        }
      ],
      'split-non-contiguous-rows'
    );
    expect(split.outcomes).toEqual(['ok', 'ok', 'ok']);
    const pendingGroups = await session.call<any[]>('groups');
    expect(pendingGroups).toHaveLength(1);
    expect(pendingGroups[0].changeSetId).toBe('split-non-contiguous-rows');

    const pendingFormulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(pendingFormulas.property_premium_subtotal).toBe('$14,249.40');
    expect(pendingFormulas.property_premium_copy_subtotal).toBe('$7,805.00');

    await session.call('resolveGroups', true);
    expect(await session.call<any[]>('groups')).toHaveLength(0);
    expect(await session.call<number>('contentControlCount')).toBe(84);

    const sourceRows = await session.call<string[]>('tableRowTexts', SOURCE);
    const copyRows = await session.call<string[]>('tableRowTexts', COPY);
    expect(sourceRows).toHaveLength(5);
    expect(sourceRows[1]).toContain('Buildings');
    expect(sourceRows[2]).toContain('Stock');
    expect(sourceRows[3]).toContain('Machinery breakdown');
    expect(sourceRows.join('|')).not.toMatch(/Contents|Business interruption/);
    expect(copyRows).toHaveLength(4);
    expect(copyRows[1]).toContain('Contents');
    expect(copyRows[2]).toContain('Business interruption');

    const sourceIds = await session.call<string[]>('tableRowIds', SOURCE);
    const copyIds = await session.call<string[]>('tableRowIds', COPY);
    expect(sourceIds).toHaveLength(3);
    expect(copyIds).toHaveLength(2);
    expect(new Set([...sourceIds, ...copyIds]).size).toBe(5);
    expect(
      await session.call<Array<string | null>>('rowShading', SOURCE)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, null]);
    expect(
      await session.call<Array<string | null>>('rowShading', COPY)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null]);

    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulas.property_premium_subtotal).toBe('$14,249.40');
    expect(formulas.property_premium_copy_subtotal).toBe('$7,805.00');
    expect(formulas.summary_subtotal).toBe('$75,667.35');
    expect(formulas.summary_tax).toBe('$6,431.72');
    expect(formulas.grand_total).toBe('$82,099.07');
  }, 120000);
});
