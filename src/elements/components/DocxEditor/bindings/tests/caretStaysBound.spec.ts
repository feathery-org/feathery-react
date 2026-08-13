// The caret must never end up outside a binding without the user putting it
// there, and a typed character must never land outside one.
//
// Both failures were reported from the browser and reproduce here against the
// real editor, because caret offsets are model state rather than layout. What
// makes them nasty is that neither is visible: the stray text renders inside the
// cell exactly as bound text would, and in the shrink case the caret's offset
// does not even change - the control's interior contracts out from under it.
//
// The offset model these tests encode, measured on 34.1.31 for a control holding
// "12":  offset 0 = opening boundary (outside), 1..3 = interior, 4 = closing
// boundary (outside).
import {
  destroyRealDocumentEditor,
  makeRealDocumentEditor
} from './realEditorHarness';
import { attachBindings } from '../attachBindings';
import { createEditorAdapter } from '../editorAdapter';
import {
  anchorCaret,
  innerRangeOf,
  resolveAnchor,
  snapOffsetForCaret,
  splitOffset
} from '../controlGeometry';
import { installKeystrokeGuard } from '../keystrokeGuard';
import { buildCostsFixture } from '../core/tests/fixtures/costsFixture';
import { parseTag } from '../core/tagDsl';
import { EngineWrite } from '../core/engine';

type AnyEditor = any;

function boundControl(editor: AnyEditor, name: string): any {
  const found = editor.documentHelper.contentControlCollection.filter(
    (control: any) => {
      if (control.type !== 0) return false;
      let def = null;
      try {
        def = parseTag(String(control.contentControlProperties?.tag || ''));
      } catch {
        return false;
      }
      return def && (def as any).name === name;
    }
  );
  if (!found.length) throw new Error(`no bound control named ${name}`);
  return found[0];
}

/** The tag of whatever content control encloses the caret, or null. */
function enclosingTag(editor: AnyEditor): string | null {
  const control = editor.selection.currentContentControl;
  return control ? String(control.contentControlProperties?.tag ?? '') : null;
}

function isCaretInside(editor: AnyEditor, name: string): boolean {
  const tag = enclosingTag(editor);
  if (!tag) return false;
  const def = parseTag(tag);
  return !!def && (def as any).name === name;
}

/** Concatenated text of the control's interior, straight from the model. */
function interiorText(editor: AnyEditor, name: string): string {
  const control = boundControl(editor, name);
  let text = '';
  let element = control.nextElement;
  while (element && element !== control.reference) {
    if (typeof element.text === 'string') text += element.text;
    element = element.nextElement;
  }
  return text;
}

/** Everything in the control's paragraph that is NOT inside the control. */
function textOutsideControl(editor: AnyEditor, name: string): string {
  const control = boundControl(editor, name);
  const paragraph = control.line.paragraph;
  const inside = new Set<unknown>();
  let element = control;
  while (element) {
    inside.add(element);
    if (element === control.reference) break;
    element = element.nextElement;
  }
  let outside = '';
  for (const line of paragraph.childWidgets || []) {
    for (const child of (line as any).children || []) {
      if (!inside.has(child) && typeof child.text === 'string')
        outside += child.text;
    }
  }
  return outside;
}

function caretAt(editor: AnyEditor, offset: string): void {
  editor.selection.select(offset, offset);
}

function offsetInside(editor: AnyEditor, name: string, from: 'start' | 'end') {
  const range = innerRangeOf(editor, boundControl(editor, name));
  if (!range) throw new Error('no inner range');
  return `${range.prefix}${from === 'start' ? range.start : range.end}`;
}

/** The boundary offset just past the control's interior - outside it. */
function offsetPastEnd(editor: AnyEditor, name: string): string {
  const range = innerRangeOf(editor, boundControl(editor, name));
  if (!range) throw new Error('no inner range');
  return `${range.prefix}${range.end + 1}`;
}

describe('control geometry', () => {
  let editor: AnyEditor;

  beforeEach(() => {
    editor = makeRealDocumentEditor(buildCostsFixture());
  });

  afterEach(() => {
    destroyRealDocumentEditor(editor);
  });

  it('reads a control interior without moving the caret', () => {
    const start = offsetInside(editor, 'quantity', 'start');
    caretAt(editor, start);
    const before = editor.selection.startOffset;

    const range = innerRangeOf(editor, boundControl(editor, 'quantity'));

    expect(range).toEqual({ prefix: '0;2;1;1;0;', start: 1, end: 3 });
    // The point of reading geometry this way rather than by selecting.
    expect(editor.selection.startOffset).toBe(before);
  });

  it('agrees with the editor about which offsets are inside', () => {
    const range = innerRangeOf(editor, boundControl(editor, 'quantity'))!;
    for (let index = range.start; index <= range.end; index++) {
      caretAt(editor, `${range.prefix}${index}`);
      expect(isCaretInside(editor, 'quantity')).toBe(true);
    }
    // And that the boundaries are genuinely outside.
    caretAt(editor, `${range.prefix}${range.start - 1}`);
    expect(isCaretInside(editor, 'quantity')).toBe(false);
    caretAt(editor, `${range.prefix}${range.end + 1}`);
    expect(isCaretInside(editor, 'quantity')).toBe(false);
  });

  it('anchors a caret to its control and survives a resize', () => {
    caretAt(editor, offsetInside(editor, 'quantity', 'end'));
    const anchor = anchorCaret(editor);
    expect(anchor).toMatchObject({ prefix: '0;2;1;1;0;', relative: 2 });

    // Shrink the interior from "12" to "5" under the anchored caret.
    editor.editorModule.updateContentControl(
      boundControl(editor, 'quantity'),
      '5'
    );

    const resolved = resolveAnchor(editor, anchor!);
    // Relative offset 2 no longer exists, so it clamps to the interior end.
    expect(resolved).toBe('0;2;1;1;0;2');
    caretAt(editor, resolved!);
    expect(isCaretInside(editor, 'quantity')).toBe(true);
  });

  it('offers a snap target on a boundary and none inside', () => {
    caretAt(editor, offsetPastEnd(editor, 'quantity'));
    expect(snapOffsetForCaret(editor)).toBe('0;2;1;1;0;3');

    caretAt(editor, offsetInside(editor, 'quantity', 'start'));
    expect(snapOffsetForCaret(editor)).toBeNull();
  });

  it('leaves a non-collapsed selection alone', () => {
    const range = innerRangeOf(editor, boundControl(editor, 'quantity'))!;
    // A deliberate range spanning the closing boundary must not be moved.
    editor.selection.select(
      `${range.prefix}${range.start}`,
      `${range.prefix}${range.end + 1}`
    );
    expect(snapOffsetForCaret(editor)).toBeNull();
  });
});

describe('typing cannot land outside a binding', () => {
  let editor: AnyEditor;
  let uninstall: () => void;

  beforeEach(() => {
    editor = makeRealDocumentEditor(buildCostsFixture());
    uninstall = installKeystrokeGuard(editor);
  });

  afterEach(() => {
    uninstall();
    destroyRealDocumentEditor(editor);
  });

  it('routes a character typed on the closing boundary into the control', () => {
    caretAt(editor, offsetPastEnd(editor, 'quantity'));
    expect(isCaretInside(editor, 'quantity')).toBe(false);

    editor.editorModule.handleTextInput('7');

    expect(interiorText(editor, 'quantity')).toBe('127');
    // The regression: this used to be "7", a sibling inline after the control.
    expect(textOutsideControl(editor, 'quantity')).toBe('');
    expect(isCaretInside(editor, 'quantity')).toBe(true);
  });

  it('routes a character typed on the opening boundary into the control', () => {
    const range = innerRangeOf(editor, boundControl(editor, 'quantity'))!;
    caretAt(editor, `${range.prefix}${range.start - 1}`);

    editor.editorModule.handleTextInput('9');

    expect(interiorText(editor, 'quantity')).toBe('912');
    expect(textOutsideControl(editor, 'quantity')).toBe('');
  });

  it('still blocks a letter, now that the boundary reports the field', () => {
    caretAt(editor, offsetPastEnd(editor, 'quantity'));

    editor.editorModule.handleTextInput('X');

    // Previously the boundary reported the enclosing table marker, the guard
    // found no field type, and the letter went in outside the control.
    expect(interiorText(editor, 'quantity')).toBe('12');
    expect(textOutsideControl(editor, 'quantity')).toBe('');
  });

  it('leaves ordinary typing inside a control untouched', () => {
    caretAt(editor, offsetInside(editor, 'quantity', 'end'));
    editor.editorModule.handleTextInput('7');
    expect(interiorText(editor, 'quantity')).toBe('127');
  });
});

describe('a write never strands the caret outside its control', () => {
  let editor: AnyEditor;

  beforeEach(() => {
    editor = makeRealDocumentEditor(buildCostsFixture());
  });

  afterEach(() => {
    destroyRealDocumentEditor(editor);
  });

  it('keeps the caret inside when the write shortens the text', () => {
    const adapter = createEditorAdapter(editor);
    // "0012" normalizes to "12": the interior loses two offsets.
    editor.editorModule.updateContentControl(
      boundControl(editor, 'quantity'),
      '0012'
    );
    caretAt(editor, offsetInside(editor, 'quantity', 'end'));
    const before = editor.selection.startOffset;

    const writes: EngineWrite[] = [
      {
        tag: String(
          boundControl(editor, 'quantity').contentControlProperties.tag
        ),
        text: '12',
        kind: 'field'
      }
    ];
    expect(adapter.updateValues!(writes)).toBe(true);

    // The offset itself is allowed to change; being outside the control is not.
    expect(isCaretInside(editor, 'quantity')).toBe(true);
    expect(splitOffset(editor.selection.startOffset)!.index).toBeLessThan(
      splitOffset(before)!.index
    );
  });

  it('keeps the caret in place when another control is written', () => {
    const adapter = createEditorAdapter(editor);
    caretAt(editor, offsetInside(editor, 'quantity', 'end'));
    const before = editor.selection.startOffset;

    const writes: EngineWrite[] = [
      {
        tag: String(
          boundControl(editor, 'line_total').contentControlProperties.tag
        ),
        text: '$9,999.00',
        kind: 'formula'
      }
    ];
    expect(adapter.updateValues!(writes)).toBe(true);

    expect(editor.selection.startOffset).toBe(before);
    expect(isCaretInside(editor, 'quantity')).toBe(true);
  });
});

describe('a write restores both scroll axes', () => {
  // Deliberately NOT against the real editor. Syncfusion's own scrollToPosition
  // advances scrollLeft by `(pageContainer.offsetWidth / 100) * 15 +
  // scrollBarWidth` inside a while loop that exits only when scrollLeft reaches
  // 0. jsdom performs no layout, so offsetWidth is 0, the increment is 0, and a
  // non-zero scrollLeft makes that loop non-terminating - it hangs the run
  // outright rather than failing. Anyone tempted to set scrollLeft on a real
  // viewerContainer in a jsdom test should expect the same.
  //
  // That loop is also the evidence for the bug: the write path really does move
  // scrollLeft, and the adapter used to put back only scrollTop, leaving the
  // document horizontally offset after every commit. What needs proving is the
  // adapter's contract, so the editor here is a stub whose write scrolls.
  function stubEditor(host: { scrollTop: number; scrollLeft: number }) {
    return {
      serialize: () => '{}',
      open: () => {},
      documentHelper: {
        contentControlCollection: [
          { contentControlProperties: { tag: '[[name=x]]' } }
        ],
        viewerContainer: host
      },
      editorModule: {
        updateContentControl: () => {
          // What selectRange -> scrollToPosition does to a real container.
          host.scrollTop = 999;
          host.scrollLeft = 999;
        }
      },
      selection: {
        startOffset: '0;0;0',
        endOffset: '0;0;0',
        select: () => {}
      }
    } as any;
  }

  it('puts back scrollLeft as well as scrollTop', () => {
    const host = { scrollTop: 40, scrollLeft: 120 };
    const adapter = createEditorAdapter(stubEditor(host));

    expect(
      adapter.updateValues!([
        { tag: '[[name=x]]', text: '$4,242.00', kind: 'formula' }
      ])
    ).toBe(true);

    expect(host.scrollTop).toBe(40);
    // The regression: this used to stay at 999.
    expect(host.scrollLeft).toBe(120);
  });

  it('captures both axes in a view snapshot', () => {
    const host = { scrollTop: 7, scrollLeft: 13 };
    const adapter = createEditorAdapter(stubEditor(host));
    expect(adapter.captureView!()).toMatchObject({
      scrollTop: 7,
      scrollLeft: 13
    });
  });
});

describe('end to end, through the real commit loop', () => {
  let editor: AnyEditor;
  let attached: any;

  beforeEach(() => {
    jest.useFakeTimers();
    editor = makeRealDocumentEditor(buildCostsFixture());
    attached = attachBindings(editor);
    // loadInitial takes the open() path, whose restoreView defers a select().
    jest.advanceTimersByTime(200);
  });

  afterEach(() => {
    attached.dispose();
    destroyRealDocumentEditor(editor);
    jest.useRealTimers();
  });

  it('recalculates and leaves the caret bound after typing and tabbing', () => {
    caretAt(editor, offsetInside(editor, 'quantity', 'end'));
    editor.editorModule.handleTextInput('7');
    jest.advanceTimersByTime(500);

    // Tab into the next bound cell, which is what commits the edit.
    caretAt(editor, offsetInside(editor, 'unit_cost', 'end'));
    jest.advanceTimersByTime(500);

    expect(interiorText(editor, 'quantity')).toBe('127');
    expect(interiorText(editor, 'line_total')).toBe('$19,050.00');
    expect(isCaretInside(editor, 'unit_cost')).toBe(true);
  });

  it('recalculates when the character was typed on the boundary', () => {
    // The reported bug: the value looked edited but no total moved.
    caretAt(editor, offsetPastEnd(editor, 'quantity'));
    editor.editorModule.handleTextInput('7');
    jest.advanceTimersByTime(500);
    caretAt(editor, offsetInside(editor, 'unit_cost', 'end'));
    jest.advanceTimersByTime(500);

    expect(textOutsideControl(editor, 'quantity')).toBe('');
    expect(interiorText(editor, 'line_total')).toBe('$19,050.00');
  });

  it('does not fight a caret the user moved during a reload', () => {
    const adapter = createEditorAdapter(editor);
    const view = adapter.captureView!();
    adapter.open(JSON.stringify(attached.controller.workingSfdt));
    // The user clicks into a cell inside the 60ms window.
    const chosen = offsetInside(editor, 'unit_cost', 'end');
    adapter.restoreView!(view);
    caretAt(editor, chosen);

    jest.advanceTimersByTime(500);

    expect(editor.selection.startOffset).toBe(chosen);
  });
});
