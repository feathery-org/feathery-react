/**
 * Task 14: does SFDT survive a REAL Syncfusion DocumentEditor's
 * open() -> serialize() round trip, and does our parser read the result back
 * correctly? Every other spec in this module tests generate/parse against
 * each other only - this is the one place a real editor gets to disagree.
 *
 * Harness pattern lifted from opContracts.spec.ts / computedCells.spec.ts
 * (src/assistant/tools/docx/tests): a bare DocumentEditor in jsdom, with the
 * same crypto/getBBox shims those specs needed to construct at all.
 * `documentEditorSettings: { optimizeSfdt: false }` is added on top - that's
 * what useDocxEditor.tsx (Task 10) sets in production, and it's why
 * serialize() below comes back verbose instead of Syncfusion's compact
 * optimized form, which our parser does not read.
 *
 * Syncfusion normalizations observed empirically while building this probe:
 *   - Identity and values: NONE. open()/serialize() preserved every
 *     fblk_/ftk_ bookmark pair, table grid, and run text byte-for-byte enough
 *     that parseSfdt's output matches the pre-round-trip parse exactly, and
 *     absorbDocEdits reports zero events/tokenEdits on the round-tripped
 *     parse (the load-bearing test below). No fixture dump was needed -
 *     nothing here diverged from what generate.ts produced.
 *   - characterFormat/paragraphFormat expansion (harmless): a real editor's
 *     serialize() fills in default nested sub-objects Syncfusion owns
 *     (paragraphFormat.borders, paragraphFormat.listFormat) on every
 *     paragraph, even ones our generator left with an empty format. Our
 *     parser never reads formatting, and theme extraction is unaffected
 *     (h1's explicit overrides below still round-trip exactly) - this only
 *     means "extracted theme for an untouched block is {}" (asserted in
 *     theme.spec.ts against synthetic SFDT) does not hold against a REAL
 *     editor's output; there the untouched entry comes back non-empty but
 *     harmless. No production fix needed - documented, not chased.
 */
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

import { generateSfdt } from '../sfdt/generate';
import { parseSfdt } from '../sfdt/parse';
import { SAMPLE_DOCUMENT } from '../sampleDocument';
import { componentsSfdt, extractTheme } from '../theme';
import { absorbDocEdits } from '../diff';
import { EMPTY_THEME } from '../types';

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
if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

const VALUES = new Map([
  ['customer_name', 'Acme Corp'],
  ['retainer', '$1,500.00'],
  ['total', '$1,620.00']
]);

function makeEditor(sfdt: string): DocumentEditor {
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
    enableEditorHistory: true,
    // Task 10's production setting: verbose SFDT out, which parse.ts expects.
    documentEditorSettings: { optimizeSfdt: false }
  });
  editor.appendTo(host);
  editor.open(sfdt);
  return editor;
}

function destroyEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

/** open() -> serialize(), the loop the whole feature is built on. */
function roundTrip(sfdt: string): string {
  const editor = makeEditor(sfdt);
  try {
    return editor.serialize();
  } finally {
    destroyEditor(editor);
  }
}

describe('real DocumentEditor round trip', () => {
  it('preserves block identity, in order, including the pricing table', () => {
    const serialized = roundTrip(generateSfdt(SAMPLE_DOCUMENT, VALUES));
    const parsed = parseSfdt(serialized);
    const ids = parsed.sections.flat().map((b) => b.id);
    expect(ids).toEqual(
      SAMPLE_DOCUMENT.sections.flatMap((s) => s.blocks.map((b) => b.id))
    );
    const table = parsed.sections.flat().find((b) => b.kind === 'table');
    expect(table?.id).toBe('blk_pricing_tbl');
  });

  it('preserves token values', () => {
    const serialized = roundTrip(generateSfdt(SAMPLE_DOCUMENT, VALUES));
    const parsed = parseSfdt(serialized);
    const allRuns = parsed.sections
      .flat()
      .flatMap((b) => b.runs ?? b.cells?.flat().flat() ?? []);
    const byKey = new Map(
      allRuns.filter((r) => r.kind === 'token').map((r: any) => [r.key, r.text])
    );
    expect(byKey.get('customer_name')).toBe('Acme Corp');
    expect(byKey.get('retainer')).toBe('$1,500.00');
    expect(byKey.get('total')).toBe('$1,620.00');
  });

  it('produces zero phantom diff: the real editor introduces no changes our sync loop would see', () => {
    const serialized = roundTrip(generateSfdt(SAMPLE_DOCUMENT, VALUES));
    const parsed = parseSfdt(serialized);
    const result = absorbDocEdits(SAMPLE_DOCUMENT, parsed, VALUES);
    expect(result.events).toEqual([]);
    expect(result.tokenEdits.size).toBe(0);
  });

  it('components doc round trip: theme extraction survives with all five entries', () => {
    const theme = {
      ...EMPTY_THEME,
      h1: {
        characterFormat: { fontSize: 28, bold: true },
        paragraphFormat: { textAlignment: 'Center' }
      },
      table: {
        tableFormat: { preferredWidthType: 'Percent' },
        headerRow: { characterFormat: { bold: true } },
        body: { characterFormat: {} }
      }
    };
    const serialized = roundTrip(componentsSfdt(theme));
    const extracted = extractTheme(serialized);
    expect(extracted.h1.characterFormat).toMatchObject({
      fontSize: 28,
      bold: true
    });
    expect(extracted.h1.paragraphFormat).toMatchObject({
      textAlignment: 'Center'
    });
    expect(extracted.table.tableFormat).toMatchObject({
      preferredWidthType: 'Percent'
    });
    expect(extracted.table.headerRow.characterFormat).toMatchObject({
      bold: true
    });
    // h2/h3/paragraph carry no theme override in this fixture. Against
    // synthetic SFDT that would extract to exactly {} (theme.spec.ts), but a
    // real editor's serialize() fills in its own default format sub-objects
    // (see file header) - so here we only require that extraction didn't
    // throw and produced the Theme shape, cmp anchors intact.
    expect(extracted.h2).toEqual(
      expect.objectContaining({ characterFormat: expect.any(Object) })
    );
    expect(extracted.h3).toEqual(
      expect.objectContaining({ characterFormat: expect.any(Object) })
    );
    expect(extracted.paragraph).toEqual(
      expect.objectContaining({ characterFormat: expect.any(Object) })
    );
  });
});
