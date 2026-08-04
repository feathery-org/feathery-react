
import {
  bookmarkFor,
  ContentControlInfo,
  decodeTag,
  EditorLike,
  encodeTag,
  readTokens,
  shadeTokens,
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

  const editor: EditorLike & { log: string[]; controls: ContentControlInfo[] } =
    {
      log,
      controls,
      exportContentControlData: () => controls.map((c) => ({ ...c })),
      getBookmarks: () => controls.map((c) => bookmarkFor(addressOf(c))),
      selection: {
        getContentControlInfo: () => caret,
        selectBookmark: (name: string, exclude?: boolean) => {
          selected = name;
          log.push(`select ${name} exclusive=${Boolean(exclude)}`);
        },
        select: (start: string, end: string) => {
          editor.selection.startOffset = start;
          editor.selection.endOffset = end;
          log.push(`caret ${start}-${end}`);
        },
        startOffset: '0;0;4',
        endOffset: '0;0;4',
        // The value of whatever bookmark is currently selected, so a
        // collapsed selection is distinguishable from a real range.
        get text() {
          return controls.find((c) => bookmarkFor(addressOf(c)) === selected)
            ?.value;
        },
        characterFormat: {
          set highlightColor(color: string) {
            log.push(`highlight ${selected} ${color}`);
          }
        }
      },
      editor: {
        insertText: (text: string) => {
          const target = controls.find((c) => bookmarkFor(addressOf(c)) === selected);
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
      documentHelper: { viewerContainer: { scrollTop: 0, scrollLeft: 0 } }
    };

  return Object.assign(editor, {
    setCaret: (info?: ContentControlInfo) => {
      caret = info;
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

  it('addresses by bookmark, excluding the markers from the selection', () => {
    const editor = fakeEditor([control(qty, '10')]);
    writeValues(editor, [{ id: 'qty__0', text: '20' }]);

    expect(editor.log).toContain(
      `select ${bookmarkFor('qty__0')} exclusive=true`
    );
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

describe('shadeTokens', () => {
  it('shades an editable token, and marks a failing one', () => {
    const editor = fakeEditor([control(qty, '10'), control(unitCost, '$150.00')]);

    expect(
      shadeTokens(editor, [
        { instance: 'qty__0', shade: 'input' },
        { instance: 'unit_cost__0', shade: 'invalid' }
      ])
    ).toEqual(['qty__0', 'unit_cost__0']);
    expect(editor.log).toContain(`highlight ${bookmarkFor('qty__0')} Turquoise`);
    expect(editor.log).toContain(
      `highlight ${bookmarkFor('unit_cost__0')} Pink`
    );
  });

  it('never enters the undo stack — Ctrl+Z must undo an edit, not a colour', () => {
    const editor = fakeEditor([control(qty, '10')]);
    shadeTokens(editor, [{ instance: 'qty__0', shade: 'input' }]);
    expect(editor.log).not.toContain('undo:begin');
  });

  it('skips an appearance it cannot address', () => {
    const editor = fakeEditor([control(qty, '10')]);
    expect(
      shadeTokens(editor, [{ instance: 'nope__9', shade: 'input' }])
    ).toEqual([]);
  });

  it('refuses to shade a collapsed selection', () => {
    // Colouring a caret sets the INSERTION format, tinting whatever is typed
    // next instead of the value that is already there.
    const editor = fakeEditor([control(qty, '')]);
    expect(
      shadeTokens(editor, [{ instance: 'qty__0', shade: 'input' }])
    ).toEqual([]);
  });

  it('leaves the caret and the scroll position where they were', () => {
    const editor = fakeEditor([control(qty, '10')]);
    shadeTokens(editor, [{ instance: 'qty__0', shade: 'input' }]);
    expect(editor.log).toContain('caret 0;0;4-0;0;4');
  });
});
