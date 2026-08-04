
import {
  bookmarkFor,
  colorFor,
  ContentControlInfo,
  decodeTag,
  EditorLike,
  encodeTag,
  insertToken,
  readTokens,
  tokenAtCaret,
  writeValues
} from '../controls';
import { TokenSpec } from '../plan';

/**
 * A stand-in for Syncfusion that records what the boundary asked it to do.
 * Its behaviour mirrors what the runtime probe measured: search-then-insert
 * replaces the found text, and undo actions wrap a batch.
 */
const fakeEditor = (controls: ContentControlInfo[]) => {
  const log: string[] = [];
  let selected: string | null = null;
  let caret: ContentControlInfo | undefined;

  const idOf = (info: ContentControlInfo) => decodeTag(info.tag)?.id;

  const editor: EditorLike & { log: string[]; controls: ContentControlInfo[] } =
    {
      log,
      controls,
      exportContentControlData: () => controls.map((c) => ({ ...c })),
      getBookmarks: () =>
        controls.map((c) => bookmarkFor(idOf(c) as string)).filter(Boolean),
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
        endOffset: '0;0;4'
      },
      editor: {
        insertText: (text: string) => {
          const target = controls.find(
            (c) => bookmarkFor(idOf(c) as string) === selected
          );
          if (target) {
            log.push(`write ${target.tag} = ${text}`);
            target.value = text;
          }
        },
        insertContentControl: (info: ContentControlInfo) => {
          log.push(
            `insert ${info.tag} canEdit=${info.canEdit} canDelete=${info.canDelete}`
          );
          controls.push({ ...info });
          return info;
        },
        insertBookmark: (name: string) => log.push(`bookmark ${name}`)
      },
      editorHistory: {
        beginUndoAction: () => log.push('undo:begin'),
        endUndoAction: () => log.push('undo:end')
      }
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

const qty: TokenSpec = { id: 'qty_1', source: 'qty' };
const itemTotal: TokenSpec = {
  id: 'item_total_1',
  formula: 'qty_1 * unit_cost_1'
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
    expect(readTokens(editor).map((t) => t.spec.id)).toEqual(['qty_1']);
  });
});

describe('tokenAtCaret', () => {
  it('reports the token the caret is inside', () => {
    const editor = fakeEditor([control(qty, '10')]);
    editor.setCaret(control(qty, '10'));
    expect(tokenAtCaret(editor)?.id).toBe('qty_1');
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
      { id: 'item_total_1', text: '$3,000.00' }
    ]);

    expect(written).toEqual(['item_total_1']);
    expect(editor.controls[1].value).toBe('$3,000.00');
  });

  it('does not touch a token whose value is unchanged', () => {
    const editor = fakeEditor([control(qty, '10')]);
    const { written } = writeValues(editor, [{ id: 'qty_1', text: '10' }]);

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
        { id: 'qty_1', text: '20' },
        { id: 'item_total_1', text: '$3,000.00' }
      ],
      { skipId: 'qty_1' }
    );

    expect(written).toEqual(['item_total_1']);
    expect(editor.controls[0].value).toBe('10');
  });

  it('groups the whole batch into a single undo action', () => {
    const editor = fakeEditor([
      control(qty, '10'),
      control(itemTotal, '$1,500.00')
    ]);
    writeValues(editor, [
      { id: 'qty_1', text: '20' },
      { id: 'item_total_1', text: '$3,000.00' }
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

    expect(() => writeValues(editor, [{ id: 'qty_1', text: '20' }])).toThrow();
    expect(editor.log).toContain('undo:end');
  });

  it('reports a token it could not locate rather than failing silently', () => {
    const editor = fakeEditor([control(qty, '10')]);
    const { written, missed } = writeValues(editor, [
      { id: 'ghost_1', text: '5' }
    ]);

    expect(written).toEqual([]);
    expect(missed).toEqual(['ghost_1']);
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

    writeValues(editor, [{ id: 'item_total_1', text: '$3,000.00' }]);

    expect(editor.selection.startOffset).toBe('0;2;7');
    expect(editor.selection.endOffset).toBe('0;2;7');
    expect(editor.log[editor.log.length - 1]).toBe('caret 0;2;7-0;2;7');
  });

  it('addresses by bookmark, excluding the markers from the selection', () => {
    const editor = fakeEditor([control(qty, '10')]);
    writeValues(editor, [{ id: 'qty_1', text: '20' }]);

    expect(editor.log).toContain(
      `select ${bookmarkFor('qty_1')} exclusive=true`
    );
  });

  it('writes the right token when two share a rendered value', () => {
    // The failure mode text-searching had: both tokens read the same thing.
    const other: TokenSpec = {
      id: 'item_total_2',
      formula: 'qty_2 * unit_cost_2'
    };
    const editor = fakeEditor([
      control(itemTotal, '$0.00'),
      control(other, '$0.00')
    ]);

    writeValues(editor, [{ id: 'item_total_2', text: '$99.00' }]);

    expect(editor.controls[0].value).toBe('$0.00');
    expect(editor.controls[1].value).toBe('$99.00');
  });
});

describe('insertToken', () => {
  it('locks a computed token against editing and every token against deletion', () => {
    const editor = fakeEditor([]);
    insertToken(editor, itemTotal, '$1,500.00');

    expect(editor.log).toContain(
      `insert ${encodeTag(itemTotal)} canEdit=true canDelete=true`
    );
  });

  it('leaves an input token editable but undeletable', () => {
    const editor = fakeEditor([]);
    insertToken(editor, qty, '10');

    expect(editor.log).toContain(
      `insert ${encodeTag(qty)} canEdit=false canDelete=true`
    );
  });

  it('is one undo step covering both markers', () => {
    const editor = fakeEditor([]);
    insertToken(editor, qty, '10');
    expect(editor.log).toEqual([
      'undo:begin',
      `insert ${encodeTag(qty)} canEdit=false canDelete=true`,
      `bookmark ${bookmarkFor('qty_1')}`,
      'undo:end'
    ]);
  });
});

describe('colorFor', () => {
  it('paints inputs blue and computed tokens grey', () => {
    expect(colorFor(qty)).toBe('#2563EB');
    expect(colorFor(itemTotal)).toBe('#9CA3AF');
  });
});
