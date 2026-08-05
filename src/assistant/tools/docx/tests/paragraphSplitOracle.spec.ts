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
  LiveEditor,
  readSelection
} from '../syncfusionDocumentOps';

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

const jsdomGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((element: Element) =>
  jsdomGetComputedStyle(element)) as typeof window.getComputedStyle;

if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

const para = (text: string) => ({
  inlines: text ? [{ text }] : [],
  paragraphFormat: {}
});

const SOURCE =
  'Hilb Group empowers organizations to navigate the complex world of Insurance. Our firm includes professionals with experience across more than 30 industry segments, allowing us to incorporate relevant market considerations and regulatory awareness into client discussions.';
const FIRST =
  'Hilb Group empowers organizations to navigate the complex world of Insurance.';
const SECOND =
  'Our firm includes professionals with experience across more than 30 industry segments, allowing us to incorporate relevant market considerations and regulatory awareness into client discussions.';

it('real SyncFusion: applies the exact live full-paragraph split payload selected through the editor API', () => {
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
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(
    JSON.stringify({
      sections: [
        { blocks: [para('Earlier section.')] },
        { blocks: [para('Another section.')] },
        {
          blocks: [
            ...Array.from({ length: 11 }, (_, index) =>
              para(`Context paragraph ${index + 1}.`)
            ),
            {
              paragraphFormat: {},
              inlines: [
                {
                  text: SOURCE,
                  characterFormat: { fontFamily: 'Arial', fontSize: 10 }
                }
              ]
            }
          ]
        }
      ]
    })
  );

  try {
    editor.enableTrackChanges = true;
    editor.selection.select('2;11;0', '2;11;273');
    const selection = readSelection(editor as unknown as LiveEditor)!;
    expect(selection).toMatchObject({
      anchor: '2;11',
      text: `${SOURCE}\r`,
      startOffset: '2;11;0',
      endOffset: '2;11;273'
    });

    const dependentOps =
      process.env.PARAGRAPH_SPLIT_ORACLE_STRATEGY === 'dependent-ops';
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'split-selection-into-two-paragraphs',
      edits: dependentOps
        ? [
            {
              op: 'replace_text',
              group: 'g01-split-selected-paragraph',
              anchor: '2;11',
              expect: SOURCE,
              find: SOURCE,
              replace: FIRST
            } as any,
            {
              op: 'insert_text',
              group: 'g01-split-selected-paragraph',
              anchor: '2;11',
              expect: FIRST,
              text: SECOND,
              position: 'after'
            } as any
          ]
        : [
            {
              op: 'replace_selection',
              group: 'g01-split-selected-paragraph',
              anchor: '2;11',
              expect: `${SOURCE}\r`,
              replace: `${FIRST}\n\n${SECOND}`,
              startOffset: '2;11;0',
              endOffset: '2;11;273'
            } as any
          ]
    });

    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          op: dependentOps ? 'replace_text' : 'replace_selection',
          anchor: '2;11'
        })
      ])
    );
    if (dependentOps)
      expect(result.results[1]).toMatchObject({
        ok: true,
        op: 'insert_text',
        anchor: '2;11'
      });
    expect(result.results.map(({ message }) => message)).toEqual(
      result.results.map(() => undefined)
    );
    expect(result.changeSet).toMatchObject({ status: 'applied' });
    expect(result.changeSet?.groups).toEqual([
      expect.objectContaining({
        id: 'g01-split-selected-paragraph',
        opIndices: dependentOps ? [0, 1] : [0]
      })
    ]);
    expect(
      flattenSfdt(JSON.parse(editor.serialize()))
        .slice(13)
        .map((block) => block.text)
    ).toEqual(dependentOps ? [FIRST, SECOND] : [FIRST, '', SECOND]);
    for (const anchor of ['2;11', dependentOps ? '2;12' : '2;13']) {
      editor.selection.select(`${anchor};1`, `${anchor};2`);
      expect(editor.selection.characterFormat.fontSize).toBe(10);
    }
  } finally {
    const element = editor.element;
    editor.destroy();
    element?.remove();
  }
});
