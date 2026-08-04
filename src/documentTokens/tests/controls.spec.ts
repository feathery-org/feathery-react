import {
  bookmarkFor,
  ContentControlInfo,
  decodeTag,
  EditorLike,
  encodeTag,
  readTokens,
  tokenAtCaret,
  writeValues
} from '../controls';
import { instanceKey, TokenSpec, valueKey } from '../plan';

/**
 * A stand-in for Syncfusion that records what the boundary asked it to do.
 * Its behaviour mirrors what the runtime probe measured: search-then-insert
 * replaces the found text, and undo actions wrap a batch.
 */
const fakeEditor = (controls: ContentControlInfo[]) => {
  const log: string[] = [];
  let selected: string | null = null;
  let caret: ContentControlInfo | undefined;

  const keyOf = (info: ContentControlInfo) =>
    valueKey(decodeTag(info.tag) as TokenSpec);
  const addressOf = (info: ContentControlInfo) =>
    instanceKey(decodeTag(info.tag) as TokenSpec);

  // Bookmarks a reader has destroyed by deleting a value outright. Measured:
  // the control survives that, the bookmark does not.
  const destroyed = new Set<string>();

  const editor: EditorLike & { log: string[]; controls: ContentControlInfo[] } =
    {
      log,
      controls,
      exportContentControlData: () => controls.map((c) => ({ ...c })),
      getBookmarks: () =>
        controls
          .filter((c) => !destroyed.has(addressOf(c)))
          .map((c) => bookmarkFor(addressOf(c))),
      selection: {
        getContentControlInfo: () => caret,
        selectBookmark: (name: string, exclude?: boolean) => {
          const found = controls.find(
            (c) => bookmarkFor(addressOf(c)) === name
          );
          selected = found ? addressOf(found) : null;
          log.push(`select bookmark ${name} exclusive=${Boolean(exclude)}`);
        },
        select: (start: string, end: string) => {
          editor.selection.startOffset = start;
          editor.selection.endOffset = end;
          log.push(`caret ${start}-${end}`);
        },
        startOffset: '0;0;4',
        endOffset: '0;0;4',
        // The value of whatever appearance is currently selected, so a
        // collapsed selection is distinguishable from a real range.
        get text() {
          return controls.find((c) => addressOf(c) === selected)?.value;
        }
      },
      editor: {
        insertText: (text: string) => {
          const target = controls.find((c) => addressOf(c) === selected);
          if (target) {
            log.push(`write ${keyOf(target)} = ${text}`);
            target.value = text;
          }
        }
      },
      editorHistory: {
        beginUndoAction: () => log.push('undo:begin'),
        endUndoAction: () => log.push('undo:end')
      },
      documentHelper: {
        viewerContainer: { scrollTop: 0, scrollLeft: 0 },
        // Syncfusion's own collection: control start elements carrying the tag.
        contentControlCollection: controls.map((c) => ({
          contentControlProperties: { tag: c.tag }
        }))
      }
    };

  // The private range API the boundary prefers, since it outlives the bookmark.
  (editor.selection as any).selectContentControlInternal = (control: any) => {
    const spec = decodeTag(control?.contentControlProperties?.tag ?? '');
    selected = spec ? instanceKey(spec) : null;
    log.push(`select control ${selected}`);
  };

  return Object.assign(editor, {
    setCaret: (info?: ContentControlInfo) => {
      caret = info;
    },
    /** Delete a value the way a reader does: the bookmark goes with it. */
    emptyValue: (instance: string) => {
      const target = controls.find((c) => addressOf(c) === instance);
      if (target) target.value = '';
      destroyed.add(instance);
    },
    /** Drop the private range API, to prove the bookmark fallback still works. */
    withoutControlApi: () => {
      delete (editor.selection as any).selectContentControlInternal;
      delete (editor as any).documentHelper.contentControlCollection;
    }
  });
};

const control = (spec: TokenSpec, value: string): ContentControlInfo => ({
  title: spec.id,
  tag: encodeTag(spec),
  value,
  canEdit: Boolean(spec.formula),
  canDelete: true
});

const qty: TokenSpec = {
  id: 'qty',
  index: 0,
  source: 'qty',
  format: { kind: 'number' }
};
const unitCost: TokenSpec = {
  id: 'unit_cost',
  index: 0,
  source: 'unit_cost',
  format: { kind: 'currency' }
};
const itemTotal: TokenSpec = {
  id: 'item_total',
  index: 0,
  formula: 'qty * unit_cost'
};

describe('tag encoding', () => {
  it('round-trips a spec', () => {
    expect(decodeTag(encodeTag(itemTotal))).toEqual(itemTotal);
  });

  it('ignores controls that are not ours', () => {
    expect(decodeTag('someone-elses-tag')).toBeNull();
  });

  it('survives a malformed payload without throwing', () => {
    expect(decodeTag('ftk:{not json')).toBeNull();
  });

  it('rejects a payload with no id', () => {
    expect(decodeTag('ftk:{"formula":"1+1"}')).toBeNull();
  });
});

describe('readTokens', () => {
  it('returns our tokens with their current values', () => {
    const editor = fakeEditor([
      control(qty, '10'),
      control(itemTotal, '$1,500.00')
    ]);
    expect(readTokens(editor)).toEqual([
      { spec: qty, value: '10' },
      { spec: itemTotal, value: '$1,500.00' }
    ]);
  });

  it('skips foreign content controls', () => {
    const editor = fakeEditor([
      control(qty, '10'),
      {
        title: 'Theirs',
        tag: 'other:thing',
        value: 'x',
        canEdit: false,
        canDelete: false
      }
    ]);
    expect(readTokens(editor).map((t) => t.spec.id)).toEqual(['qty']);
  });
});

describe('tokenAtCaret', () => {
  it('reports the token the caret is inside', () => {
    const editor = fakeEditor([control(qty, '10')]);
    editor.setCaret(control(qty, '10'));
    expect(tokenAtCaret(editor)?.id).toBe('qty');
  });

  it('reports nothing in ordinary prose', () => {
    const editor = fakeEditor([control(qty, '10')]);
    editor.setCaret(undefined);
    expect(tokenAtCaret(editor)).toBeNull();
  });
});

describe('writeValues', () => {
  it('writes changed values and reports them', () => {
    const editor = fakeEditor([
      control(qty, '10'),
      control(itemTotal, '$1,500.00')
    ]);
    const { written } = writeValues(editor, [
      { id: 'item_total__0', text: '$3,000.00' }
    ]);

    expect(written).toEqual(['item_total__0']);
    expect(editor.controls[1].value).toBe('$3,000.00');
  });

  it('does not touch a token whose value is unchanged', () => {
    const editor = fakeEditor([control(qty, '10')]);
    const { written } = writeValues(editor, [{ id: 'qty__0', text: '10' }]);

    expect(written).toEqual([]);
    expect(editor.log).toEqual([]); // no undo action opened at all
  });

  it('skips the token being edited so the caret is not yanked', () => {
    const editor = fakeEditor([
      control(qty, '10'),
      control(itemTotal, '$1,500.00')
    ]);
    const { written } = writeValues(
      editor,
      [
        { id: 'qty__0', text: '20' },
        { id: 'item_total__0', text: '$3,000.00' }
      ],
      { skipId: 'qty__0' }
    );

    expect(written).toEqual(['item_total__0']);
    expect(editor.controls[0].value).toBe('10');
  });

  it('groups the whole batch into a single undo action', () => {
    const editor = fakeEditor([
      control(qty, '10'),
      control(itemTotal, '$1,500.00')
    ]);
    writeValues(editor, [
      { id: 'qty__0', text: '20' },
      { id: 'item_total__0', text: '$3,000.00' }
    ]);

    expect(editor.log.filter((l) => l === 'undo:begin')).toHaveLength(1);
    expect(editor.log.filter((l) => l === 'undo:end')).toHaveLength(1);
    expect(editor.log[0]).toBe('undo:begin');
    // Every write falls inside the undo action; restoring the caret comes
    // after it, since putting the cursor back is not an undoable edit.
    const writes = editor.log
      .map((l: string, i: number) => (l.startsWith('write ') ? i : -1))
      .filter((i: number) => i >= 0);
    const end = editor.log.indexOf('undo:end');
    expect(Math.max(...writes)).toBeLessThan(end);
  });

  it('closes the undo action even when a write throws', () => {
    const editor = fakeEditor([control(qty, '10')]);
    editor.editor.insertText = () => {
      throw new Error('editor exploded');
    };

    expect(() => writeValues(editor, [{ id: 'qty__0', text: '20' }])).toThrow();
    expect(editor.log).toContain('undo:end');
  });

  it('reports a token it could not locate rather than failing silently', () => {
    const editor = fakeEditor([control(qty, '10')]);
    const { written, missed } = writeValues(editor, [
      { id: 'ghost', text: '5' }
    ]);

    expect(written).toEqual([]);
    expect(missed).toEqual(['ghost']);
  });

  it('puts the caret back where it was after propagating', () => {
    // Writing selects each bookmark in turn; the user's cursor must not end
    // up parked on the last token that happened to move.
    const editor = fakeEditor([
      control(qty, '10'),
      control(itemTotal, '$1,500.00')
    ]);
    editor.selection.startOffset = '0;2;7';
    editor.selection.endOffset = '0;2;7';

    writeValues(editor, [{ id: 'item_total__0', text: '$3,000.00' }]);

    expect(editor.selection.startOffset).toBe('0;2;7');
    expect(editor.selection.endOffset).toBe('0;2;7');
    expect(editor.log[editor.log.length - 1]).toBe('caret 0;2;7-0;2;7');
  });

  it('leaves the scroll position where it was', () => {
    // Selecting a bookmark scrolls it into view; writing several tokens must
    // not drag the page around under the user.
    const editor = fakeEditor([
      control(qty, '10'),
      control(itemTotal, '$1,500.00')
    ]);
    const viewport = editor.documentHelper.viewerContainer;
    viewport.scrollTop = 820;
    viewport.scrollLeft = 40;
    // Writing scrolls the viewport, the way selectBookmark does.
    editor.editor.insertText = (text: string) => {
      viewport.scrollTop = 0;
      const target = editor.controls.find(
        (c: ContentControlInfo) => c.value === '$1,500.00'
      );
      if (target) target.value = text;
    };

    writeValues(editor, [{ id: 'item_total__0', text: '$3,000.00' }]);

    expect(viewport.scrollTop).toBe(820);
    expect(viewport.scrollLeft).toBe(40);
  });

  it('addresses a value by its content control', () => {
    const editor = fakeEditor([control(qty, '10')]);
    writeValues(editor, [{ id: 'qty__0', text: '20' }]);

    expect(editor.log).toContain('select control qty__0');
    expect(editor.controls[0].value).toBe('20');
  });

  it('reformats a value whose bookmark the reader destroyed', () => {
    // Deleting a value outright takes its bookmark with it, measured against a
    // real editor. The control survives, so the value must still be writable —
    // otherwise a cleared token never gets its formatting back.
    const editor = fakeEditor([control(unitCost, '$150.00')]);
    editor.emptyValue('unit_cost__0');
    editor.controls[0].value = '100'; // what the reader retyped

    const { written, missed } = writeValues(editor, [
      { id: 'unit_cost__0', text: '$100.00' }
    ]);

    expect(missed).toEqual([]);
    expect(written).toEqual(['unit_cost__0']);
    expect(editor.controls[0].value).toBe('$100.00');
  });

  it('writes into a token the reader left empty', () => {
    const editor = fakeEditor([control(unitCost, '$150.00')]);
    editor.emptyValue('unit_cost__0');

    const { missed } = writeValues(editor, [
      { id: 'unit_cost__0', text: '$0.00' }
    ]);

    expect(missed).toEqual([]);
    expect(editor.controls[0].value).toBe('$0.00');
  });

  it('falls back to the bookmark when the private range API is gone', () => {
    // A version bump could take selectContentControlInternal away; an untouched
    // token must still be addressable.
    const editor = fakeEditor([control(qty, '10')]);
    editor.withoutControlApi();

    writeValues(editor, [{ id: 'qty__0', text: '20' }]);

    expect(editor.log).toContain(
      `select bookmark ${bookmarkFor('qty__0')} exclusive=true`
    );
    expect(editor.controls[0].value).toBe('20');
  });

  it('writes the right token when two share a rendered value', () => {
    // The failure mode text-searching had: both tokens read the same thing.
    const other: TokenSpec = {
      id: 'item_total',
      index: 1,
      formula: 'qty * unit_cost'
    };
    const editor = fakeEditor([
      control(itemTotal, '$0.00'),
      control(other, '$0.00')
    ]);

    writeValues(editor, [{ id: 'item_total__1', text: '$99.00' }]);

    expect(editor.controls[0].value).toBe('$0.00');
    expect(editor.controls[1].value).toBe('$99.00');
  });
});
