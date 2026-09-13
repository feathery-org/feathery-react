// User typing inside content controls must stay untracked, the same contract
// as prose. Two content-control-specific leaks made keystrokes look like
// tracked edits even after Assist batches force enableTrackChanges off:
//
//   1. editorAdapter.updateValues restored a leftover true after every
//      bound-field reconcile (Enter/blur inside a control).
//   2. handleTextInput — the only path printable characters take into a bound
//      field — honored that leftover flag. The keystroke guard now forces it
//      off before the character lands.
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
import { applyDocumentEdits, LiveEditor } from '../syncfusionDocumentOps';
import {
  listRevisionGroups,
  resolveLiveRevisionGroupsAsOneUndo
} from '../../../../utils/documentEditorPrimitives';
import {
  destroyRealDocumentEditor,
  docWith,
  makeRealDocumentEditor,
  para,
  taggedInline,
  textRun
} from '../../../../elements/components/DocxEditor/bindings/tests/realEditorHarness';
import { innerRangeOf } from '../../../../elements/components/DocxEditor/bindings/controlGeometry';
import { attachBindings } from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { buildCostsFixture } from '../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import { parseTag } from '../../../../elements/components/DocxEditor/bindings/core/tagDsl';
import { installKeystrokeGuard } from '../../../../elements/components/DocxEditor/bindings/keystrokeGuard';
import { createEditorAdapter } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';

DocumentEditor.Inject(
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport
);

const PREMIUM_TAG = '[[name=premium]]';

const revisionTexts = (ed: DocumentEditor): string[] =>
  Array.from({ length: ed.revisions.length }, (_, index) =>
    ((ed.revisions.get(index) as any).getRange?.() ?? [])
      .map((el: any) => el.text ?? '')
      .join('')
  );

const openingControl = (ed: DocumentEditor, tag?: string): any => {
  const found = (ed.documentHelper as any).contentControlCollection.filter(
    (control: any) =>
      control.type === 0 &&
      (!tag || String(control.contentControlProperties?.tag) === tag)
  );
  if (!found.length) throw new Error(`no opening content control ${tag ?? ''}`);
  return found[0];
};

const interiorText = (control: any): string => {
  let text = '';
  let element = control.nextElement;
  while (element && element !== control.reference) {
    if (typeof element.text === 'string') text += element.text;
    element = element.nextElement;
  }
  return text;
};

const caretInside = (
  ed: DocumentEditor,
  control: any,
  at: 'start' | 'mid' | 'end'
) => {
  const range = innerRangeOf(ed as any, control);
  if (!range) throw new Error('no inner range');
  const index =
    at === 'start'
      ? range.start
      : at === 'end'
      ? range.end
      : Math.floor((range.start + range.end) / 2);
  ed.selection.select(`${range.prefix}${index}`, `${range.prefix}${index}`);
};

const quantityControl = (ed: DocumentEditor): any => {
  const found = (ed.documentHelper as any).contentControlCollection.find(
    (control: any) => {
      if (control.type !== 0) return false;
      try {
        const def = parseTag(String(control.contentControlProperties?.tag));
        return def && (def as any).name === 'quantity';
      } catch {
        return false;
      }
    }
  );
  if (!found) throw new Error('no quantity control');
  return found;
};

const plainCostsFixture = (): any => {
  const sfdt = JSON.parse(JSON.stringify(buildCostsFixture()));
  const blocks = sfdt.sections[0].blocks;
  const markerIndex = blocks.findIndex((block: any) =>
    String(block?.contentControlProperties?.tag ?? '').includes('table=costs')
  );
  const table = blocks[markerIndex].blocks.find((block: any) =>
    Array.isArray(block?.rows)
  );
  const textOf = (node: any): string => {
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (!node || typeof node !== 'object') return '';
    if (typeof node.text === 'string') return node.text;
    return textOf(node.inlines) + textOf(node.blocks);
  };
  for (const row of table.rows)
    for (const cell of row.cells) {
      const text = textOf(cell);
      delete cell.contentControlProperties;
      cell.blocks = [{ inlines: [{ text }] }];
    }
  blocks.splice(markerIndex, 1, table);
  return sfdt;
};

describe('user edits inside content controls stay untracked', () => {
  it('plain typing in a content control with tracking off authors no revision', () => {
    const ed = makeRealDocumentEditor(
      docWith(para(textRun('Premium: '), taggedInline(PREMIUM_TAG, '5500')))
    );
    try {
      ed.enableTrackChanges = false;
      caretInside(ed, openingControl(ed, PREMIUM_TAG), 'end');
      (ed as any).editorModule.insertText('XY');
      expect(interiorText(openingControl(ed, PREMIUM_TAG))).toContain('XY');
      expect(ed.revisions.length).toBe(0);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('typing into a pending tracked insertion inside a content control stays plain', () => {
    const ed = makeRealDocumentEditor(
      docWith(para(textRun('Premium: '), taggedInline(PREMIUM_TAG, '5500')))
    );
    try {
      caretInside(ed, openingControl(ed, PREMIUM_TAG), 'mid');
      ed.enableTrackChanges = true;
      ed.currentUser = 'Robin';
      (ed as any).editorModule.insertText('ROBIN');
      ed.enableTrackChanges = false;
      ed.currentUser = 'Guest user';

      caretInside(ed, openingControl(ed, PREMIUM_TAG), 'mid');
      (ed as any).editorModule.insertText('XY');

      expect(interiorText(openingControl(ed, PREMIUM_TAG))).toContain('XY');
      for (const text of revisionTexts(ed)) expect(text).not.toContain('XY');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('handleTextInput with tracking leaked on stays plain when the guard is installed', () => {
    const ed = makeRealDocumentEditor(
      docWith(para(textRun('Premium: '), taggedInline(PREMIUM_TAG, '5500')))
    );
    const uninstall = installKeystrokeGuard(ed as any);
    try {
      caretInside(ed, openingControl(ed, PREMIUM_TAG), 'end');
      ed.enableTrackChanges = true;
      ed.currentUser = 'Robin';
      (ed as any).editorModule.handleTextInput('XY');

      expect(interiorText(openingControl(ed, PREMIUM_TAG))).toContain('XY');
      for (const text of revisionTexts(ed)) expect(text).not.toContain('XY');
      expect(ed.enableTrackChanges).toBe(false);
    } finally {
      uninstall();
      destroyRealDocumentEditor(ed);
    }
  });

  it('bound-cell Assist write then user typing in the cell stays untracked', () => {
    const ed = makeRealDocumentEditor(buildCostsFixture());
    const attached = attachBindings(ed as any, { convertTokensOnOpen: false });
    try {
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'cs-qty',
        edits: [
          {
            op: 'set_cell_text',
            anchor: '0;2;1;1;0',
            text: '20',
            literal: true
          }
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      expect(ed.enableTrackChanges).toBe(false);

      const beforeTypingRevisions = revisionTexts(ed);
      const quantity = quantityControl(ed);
      caretInside(ed, quantity, 'end');
      (ed as any).editorModule.handleTextInput('7');

      expect(interiorText(quantity)).toContain('7');
      expect(revisionTexts(ed)).toEqual(beforeTypingRevisions);
      expect(listRevisionGroups(ed as any).every((group) => !group.untagged)).toBe(
        true
      );
    } finally {
      attached.dispose();
      destroyRealDocumentEditor(ed);
    }
  });

  it('updateContentControl leaves tracking off so the next keystroke stays plain', () => {
    const ed = makeRealDocumentEditor(
      docWith(para(taggedInline(PREMIUM_TAG, '12')))
    );
    try {
      ed.enableTrackChanges = true;
      const adapter = createEditorAdapter(ed as any);
      adapter.updateValues!([
        { tag: PREMIUM_TAG, text: '99', kind: 'field' }
      ]);

      expect(ed.enableTrackChanges).toBe(false);
      expect(interiorText(openingControl(ed, PREMIUM_TAG))).toBe('99');
      expect(ed.revisions.length).toBe(0);

      caretInside(ed, openingControl(ed, PREMIUM_TAG), 'end');
      (ed as any).editorModule.insertText('XY');
      for (const text of revisionTexts(ed)) expect(text).not.toContain('XY');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('keeps an input editable after promoting and accepting a plain table', () => {
    const ed = makeRealDocumentEditor(plainCostsFixture());
    const attached = attachBindings(ed as any, { convertTokensOnOpen: false });
    try {
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'promote-input',
        edits: [
          {
            op: 'create_binding',
            group: 'g01-promote-input',
            anchor: '0;2;1;1;0',
            kind: 'input',
            name: 'promoted_quantity',
            valueType: 'integer'
          }
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      const live = ed as unknown as LiveEditor;
      resolveLiveRevisionGroupsAsOneUndo(live, listRevisionGroups(live), true);

      const promoted = Array.from(
        (ed.documentHelper as any).contentControlCollection ?? []
      ).find((control: any) => {
        if (control.type !== 0) return false;
        try {
          return (
            parseTag(String(control.contentControlProperties?.tag))?.name ===
            'promoted_quantity'
          );
        } catch {
          return false;
        }
      }) as any;
      expect(promoted?.contentControlProperties?.lockContents).toBe(false);
      caretInside(ed, promoted, 'mid');
      (ed as any).editorModule.handleTextInput('7');

      expect(interiorText(promoted)).toContain('7');
    } finally {
      attached.dispose();
      destroyRealDocumentEditor(ed);
    }
  });
});
