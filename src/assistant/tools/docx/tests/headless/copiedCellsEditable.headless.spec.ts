import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

/**
 * The copied fragment of a split must be as editable as the table it came from.
 *
 * Measured before the fix (real engine, browser document): the split's fourteen
 * copied controls were appended to `contentControlCollection` after the summary
 * table's, one order break. Syncfusion's getContentControls walks the collection
 * in order and early-breaks at the first control past the caret, so inside a
 * copied cell it found nothing, `currentContentControl` was undefined, and
 * `canEditContentControl` read the cell as locked: the user could not type in
 * the new table at all. Document order in the collection is the invariant.
 */
describe('copied cells stay editable: the control collection keeps document order', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);
  afterAll(async () => {
    await session?.close();
  });

  const orderBreaks = () =>
    session.page.evaluate(() => {
      const ed: any = (document.querySelector('.e-documenteditor') as any)
        .ej2_instances[0];
      const col: any[] = ed.documentHelper.contentControlCollection;
      const sel = ed.selection;
      let prev: any = null;
      let breaks = 0;
      for (let i = 0; i < col.length; i++) {
        let pos: any = null;
        try {
          pos = sel.getPosition(col[i], true).startPosition;
        } catch {
          pos = null;
        }
        if (pos && prev && pos.isExistBefore(prev)) breaks++;
        if (pos) prev = pos;
      }
      return { count: col.length, breaks };
    });

  const editabilityAt = (word: string, occurrence: number) =>
    session.page.evaluate(
      (word: string, occurrence: number) => {
        const ed: any = (document.querySelector('.e-documenteditor') as any)
          .ej2_instances[0];
        const search = ed.search;
        search.findAll(word);
        const n = search.searchResults?.length ?? 0;
        search.searchResults.index = occurrence < 0 ? n - 1 : occurrence;
        const control = ed.editor.getContentControl();
        return {
          hits: n,
          resolved: !!control,
          tag: String(control?.contentControlProperties?.tag ?? '').slice(
            0,
            40
          ),
          canEdit: ed.editor.canEditContentControl === true
        };
      },
      word,
      occurrence
    );

  it('a split leaves the collection in document order and every copied cell editable', async () => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    expect((await orderBreaks()).breaks).toBe(0);
    const applied = await session.call<any>(
      'splitTable',
      'property_premium',
      1,
      3
    );
    expect(applied.outcomes).toEqual(['ok', 'ok', 'ok']);

    const order = await orderBreaks();
    expect(order.count).toBe(96);
    expect(order.breaks).toBe(0);

    // The copy's Stock row is the LAST "Stock" in the document.
    const copied = await editabilityAt('Stock', -1);
    expect(copied.hits).toBe(2);
    expect(copied.resolved).toBe(true);
    expect(copied.canEdit).toBe(true);
    expect(copied.tag).toContain('property_premium_co');

    // And the source is untouched by the fix.
    const source = await editabilityAt('Contents', 0);
    expect(source.resolved).toBe(true);
    expect(source.canEdit).toBe(true);
  }, 120000);
});
