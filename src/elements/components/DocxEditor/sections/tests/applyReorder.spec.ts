// The apply layer's orchestration against fake editors:
//   - an OPEN-only editor (no native SDK verbs) always falls back to open();
//   - a NATIVE-capable editor takes the native single-move path (one
//     complex-history group, no open()), and falls back to open() for a
//     multi-section move or when the native result fails verification.
// The real SDK behaviour (does the native move preserve headers/footers and
// undo/redo?) is verified live in the harness spike; here we pin the routing.
import { applyReorder, applyReorderTo, ReorderEditor } from '../applyReorder';
import { SfdtDocument } from '../../bindings/core/sfdtTypes';

const para = (text: string) => ({ inlines: [{ text }] });
const section = (label: string) => ({
  sectionFormat: { breakCode: 'Continuous' },
  blocks: [para(label)],
  headersFooters: {}
});
const docOf = (labels: string[]): SfdtDocument =>
  ({ sections: labels.map(section), styles: [] } as unknown as SfdtDocument);

const labels = (doc: SfdtDocument) =>
  (doc.sections || []).map(
    (s) => (s.blocks?.[0]?.inlines?.[0]?.text as string) || ''
  );

// Editor lacking native SDK verbs → every commit goes through open().
class OpenOnlyEditor implements ReorderEditor {
  doc: SfdtDocument;
  openCount = 0;
  selection = { startOffset: '0;0;0', select: () => undefined };
  documentHelper = { viewerContainer: { scrollTop: 0, scrollLeft: 0 } };
  constructor(doc: SfdtDocument) {
    this.doc = doc;
  }
  serialize() {
    return JSON.stringify(this.doc);
  }
  open(sfdt: string) {
    this.doc = JSON.parse(sfdt) as SfdtDocument;
    this.openCount += 1;
  }
}

// Editor exposing the native verbs. It records the command sequence and, at the
// end of a complex-history group, jumps to `target` (the order the test expects)
// so verifyNative can pass — standing in for the real SDK applying the move.
class NativeEditor implements ReorderEditor {
  doc: SfdtDocument;
  target: SfdtDocument | null = null;
  openCount = 0;
  cmds: string[] = [];
  groupsClosed = 0;
  selection = {
    startOffset: '0;0;0',
    select: () => this.cmds.push('select'),
    sectionFormat: {} as Record<string, unknown>,
    goToHeader: () => this.cmds.push('goToHeader'),
    goToFooter: () => this.cmds.push('goToFooter'),
    closeHeaderFooter: () => this.cmds.push('close')
  };
  editor = {
    delete: () => this.cmds.push('delete'),
    insertSectionBreak: () => this.cmds.push('insertSectionBreak'),
    pasteContents: () => this.cmds.push('paste'),
    initComplexHistory: () => this.cmds.push('init')
  };
  editorHistory = {
    currentHistoryInfo: undefined,
    updateComplexHistory: () => {
      this.groupsClosed += 1;
      if (this.target) this.doc = this.target;
    }
  };
  documentHelper = { viewerContainer: { scrollTop: 0, scrollLeft: 0 } };
  constructor(doc: SfdtDocument) {
    this.doc = doc;
  }
  serialize() {
    return JSON.stringify(this.doc);
  }
  open(sfdt: string) {
    this.doc = JSON.parse(sfdt) as SfdtDocument;
    this.openCount += 1;
  }
}

test('open-only editor: a move rewrites via open() and reveals', () => {
  const editor = new OpenOnlyEditor(docOf(['A', 'B', 'C']));
  const markDirty = jest.fn();
  const result = applyReorder(editor, { index: 2, delta: -2 }, { markDirty });
  expect(result.moved).toBe(true);
  expect(labels(editor.doc)).toEqual(['C', 'A', 'B']);
  expect(editor.openCount).toBe(1);
  expect(markDirty).toHaveBeenCalledTimes(1);
});

test('native editor: a single-section move goes native, no open()', () => {
  const editor = new NativeEditor(docOf(['A', 'B', 'C']));
  editor.target = docOf(['C', 'A', 'B']); // what the SDK move produces
  const markDirty = jest.fn();

  const result = applyReorderTo(editor, [2, 0, 1], { markDirty });

  expect(result.moved).toBe(true);
  expect(labels(editor.doc)).toEqual(['C', 'A', 'B']);
  expect(editor.openCount).toBe(0); // native, not open()
  expect(editor.groupsClosed).toBe(1); // one complex-history unit
  expect(editor.cmds).toEqual(
    expect.arrayContaining(['init', 'delete', 'insertSectionBreak', 'paste'])
  );
  expect(markDirty).toHaveBeenCalledTimes(1);
});

test('native editor: a multi-section move falls back to open() untouched', () => {
  const editor = new NativeEditor(docOf(['A', 'B', 'C', 'D']));
  editor.target = docOf(['C', 'D', 'A', 'B']);
  // moving a contiguous block [C,D] to the front is 2 relocations → not native
  const result = applyReorderTo(editor, [2, 3, 0, 1]);
  expect(result.moved).toBe(true);
  expect(editor.openCount).toBe(1);
  expect(editor.cmds).not.toContain('init'); // never attempted the native path
  expect(labels(editor.doc)).toEqual(['C', 'D', 'A', 'B']);
});

test('native editor: a failed verification falls back to open()', () => {
  const editor = new NativeEditor(docOf(['A', 'B', 'C']));
  // target left null → the group close does not reach the expected order, so
  // verifyNative fails and we must open().
  const result = applyReorderTo(editor, [2, 0, 1]);
  expect(result.moved).toBe(true);
  expect(editor.cmds).toContain('init'); // native was attempted
  expect(editor.openCount).toBe(1); // …then fell back to open()
  expect(labels(editor.doc)).toEqual(['C', 'A', 'B']);
});

test('a refused move leaves the editor untouched and reports diagnostics', () => {
  const editor = new NativeEditor(docOf(['only']));
  const markDirty = jest.fn();
  const onDiagnostics = jest.fn();
  const result = applyReorder(
    editor,
    { index: 0, delta: 1 },
    { markDirty, onDiagnostics }
  );
  expect(result.moved).toBe(false);
  expect(editor.openCount).toBe(0);
  expect(editor.cmds).toEqual([]);
  expect(markDirty).not.toHaveBeenCalled();
  expect(result.diagnostics.map((d) => d.code)).toEqual(['section-not-movable']);
  expect(onDiagnostics).toHaveBeenCalledWith(result.diagnostics);
});

test('refuses minified SFDT without touching the editor', () => {
  const editor = new NativeEditor({ sec: [{ b: [] }] } as unknown as SfdtDocument);
  const result = applyReorder(editor, { index: 0, delta: 1 });
  expect(result.moved).toBe(false);
  expect(editor.openCount).toBe(0);
  expect(editor.cmds).toEqual([]);
  expect(result.diagnostics.map((d) => d.code)).toEqual(['optimized-sfdt']);
});
