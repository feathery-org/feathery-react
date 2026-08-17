// The apply layer against a fake editor: a successful move rewrites the doc,
// reveals the moved section, and marks dirty; a refused move leaves everything
// untouched. (The real Syncfusion open()/reconcile path is exercised in the
// live-editor runbook — here we pin the orchestration.)
import { applyReorder, ReorderEditor } from '../applyReorder';
import { SfdtDocument } from '../../bindings/core/sfdtTypes';

const para = (text: string) => ({ inlines: [{ text }] });
const section = (label: string) => ({
  sectionFormat: { breakCode: 'Continuous' },
  blocks: [para(label)],
  headersFooters: {}
});

const threeSections = (): SfdtDocument =>
  ({
    sections: [section('A'), section('B'), section('C')],
    styles: []
  } as unknown as SfdtDocument);

class FakeEditor implements ReorderEditor {
  doc: SfdtDocument;
  openCount = 0;
  selected: [string, string][] = [];
  selection = {
    startOffset: '0;0;0',
    select: (start: string, end: string) => {
      this.selected.push([start, end]);
    }
  };
  documentHelper = { viewerContainer: { scrollTop: 0, scrollLeft: 0 } };

  constructor(doc: SfdtDocument) {
    this.doc = doc;
  }
  serialize(): string {
    return JSON.stringify(this.doc);
  }
  open(sfdt: string): void {
    this.doc = JSON.parse(sfdt) as SfdtDocument;
    this.openCount += 1;
  }
}

const labels = (doc: SfdtDocument) =>
  (doc.sections || []).map(
    (s) => (s.blocks?.[0]?.inlines?.[0]?.text as string) || ''
  );

test('a successful move rewrites the document and reveals the moved section', () => {
  const editor = new FakeEditor(threeSections());
  const markDirty = jest.fn();
  const onDiagnostics = jest.fn();

  const result = applyReorder(
    editor,
    { index: 2, delta: -2 },
    { markDirty, onDiagnostics }
  );

  expect(result.moved).toBe(true);
  expect(labels(editor.doc)).toEqual(['C', 'A', 'B']);
  expect(editor.openCount).toBe(1);
  expect(markDirty).toHaveBeenCalledTimes(1);
  // moved section (now index 0) is revealed
  expect(editor.selected).toContainEqual(['0;0;0', '0;0;0']);
});

test('a refused move leaves the editor untouched and reports diagnostics', () => {
  const editor = new FakeEditor({
    sections: [section('only')]
  } as unknown as SfdtDocument);
  const markDirty = jest.fn();
  const onDiagnostics = jest.fn();

  const result = applyReorder(
    editor,
    { index: 0, delta: 1 },
    { markDirty, onDiagnostics }
  );

  expect(result.moved).toBe(false);
  expect(editor.openCount).toBe(0);
  expect(markDirty).not.toHaveBeenCalled();
  expect(result.diagnostics.map((d) => d.code)).toEqual(['section-not-movable']);
  expect(onDiagnostics).toHaveBeenCalledWith(result.diagnostics);
});

test('refuses minified SFDT without touching the editor', () => {
  const editor = new FakeEditor({ sec: [{ b: [] }] } as unknown as SfdtDocument);
  const result = applyReorder(editor, { index: 0, delta: 1 });
  expect(result.moved).toBe(false);
  expect(editor.openCount).toBe(0);
  expect(result.diagnostics.map((d) => d.code)).toEqual(['optimized-sfdt']);
});
