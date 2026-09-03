// One generator, two outputs: the engine must reach the figures the generator
// computed, and with DOCX_FIXTURE_OUT set the .docx is written too
import 'jest-canvas-mock';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { DocumentEditor } from '@syncfusion/ej2-documenteditor';
import { attachBindings } from '../attachBindings';
import { scanBindings } from '../core/sfdtAdapter';
import { SfdtDocument } from '../core/sfdtTypes';
import {
  AGGREGATE_FILL,
  BAND_FILLS,
  BANDED_PROPOSAL_EXPECTED,
  buildBandedProposalFixture,
  buildBandedProposalTokens,
  HEADER_FILL,
  SCHEDULE_ITEMS,
  SPANNING_BOOKMARK,
  TOTAL_FILL
} from '../core/tests/fixtures/bandedProposalFixture';
import { SyncfusionEditorLike } from '../editorAdapter';
import { bindingCommandSurfaceFor } from '../reconcileRegistry';
import {
  destroyRealDocumentEditor,
  makeRealDocumentEditor
} from './realEditorHarness';

const parsed = (editor: DocumentEditor) =>
  JSON.parse(editor.serialize()) as SfdtDocument;

const formulaText = (editor: DocumentEditor, name: string): string[] =>
  scanBindings(parsed(editor))
    .occurrences.filter((occurrence) => occurrence.name === name)
    .map((occurrence) => occurrence.text);

const blobBytes = (blob: Blob) =>
  new Promise<Buffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

describe('the banded proposal generator', () => {
  it('converts every token, with the table roles the finalizer needs', () => {
    const sfdt = buildBandedProposalFixture();
    const index = scanBindings(sfdt);
    expect(index.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const schedule = index.tables.get('schedule');
    expect(schedule?.rows.map((row) => row.bindings.size)).toEqual(
      SCHEDULE_ITEMS.map(() => 4)
    );
    expect([...index.tables.keys()]).toEqual(['schedule']);
    expect(index.formulas.has('schedule_subtotal')).toBe(true);
    expect(index.formulas.has('summary_property')).toBe(true);
    expect(
      JSON.stringify(sfdt).match(new RegExp(SPANNING_BOOKMARK, 'g'))
    ).toHaveLength(2);
  });

  it('carries real banding: a shading key on every schedule data cell', () => {
    const sfdt = buildBandedProposalFixture() as any;
    const wrapper = sfdt.sections[0].blocks.find(
      (block: any) =>
        block.contentControlProperties?.tag === '[[table=schedule]]'
    );
    const rows = wrapper.blocks[0].rows;
    const fills = rows.map((row: any) =>
      row.cells.map((c: any) => c.cellFormat.shading.backgroundColor)
    );
    expect(fills[0]).toEqual([HEADER_FILL, HEADER_FILL]);
    expect(fills[1]).toEqual(Array(4).fill(HEADER_FILL));
    SCHEDULE_ITEMS.forEach((_, index) =>
      expect(fills[2 + index]).toEqual(Array(4).fill(BAND_FILLS[index % 2]))
    );
    expect(fills.slice(-3)).toEqual([
      [AGGREGATE_FILL, AGGREGATE_FILL],
      [AGGREGATE_FILL, AGGREGATE_FILL],
      [TOTAL_FILL, TOTAL_FILL]
    ]);
  });

  it('the bare-reference summary cell follows the schedule after a row delete', () => {
    const editor = makeRealDocumentEditor(buildBandedProposalFixture());
    const attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
    try {
      attached.controller.flush({ mode: 'self-heal' });
      const secondItem = scanBindings(parsed(editor)).tables.get('schedule')!
        .rows[1].rowId;
      bindingCommandSurfaceFor(editor as any)!.runCommands([
        { type: 'remove-row', tableId: 'schedule', rowId: secondItem }
      ]);
      attached.controller.flush({ mode: 'self-heal' });
      const expected = BANDED_PROPOSAL_EXPECTED.subtotalWithout([1]);
      expect(formulaText(editor, 'schedule_subtotal')).toEqual([expected]);
      expect(formulaText(editor, 'summary_property')).toEqual([expected]);
    } finally {
      attached.dispose();
      destroyRealDocumentEditor(editor);
    }
  });

  it('opens as production does and the engine reaches the computed figures', async () => {
    const editor = makeRealDocumentEditor(buildBandedProposalTokens());
    const attached = attachBindings(editor as unknown as SyncfusionEditorLike);
    try {
      attached.controller.flush({ mode: 'self-heal' });
      const expected = BANDED_PROPOSAL_EXPECTED;
      expect(formulaText(editor, 'line_total')).toEqual(expected.lineTotals);
      expect(formulaText(editor, 'schedule_subtotal')).toEqual([
        expected.scheduleSubtotal
      ]);
      expect(formulaText(editor, 'schedule_tax')).toEqual([
        expected.scheduleTax
      ]);
      expect(formulaText(editor, 'schedule_total')).toEqual([
        expected.scheduleTotal
      ]);
      expect(formulaText(editor, 'summary_property')).toEqual([
        expected.summaryProperty
      ]);
      expect(formulaText(editor, 'summary_tax')).toEqual([expected.summaryTax]);
      expect(formulaText(editor, 'summary_total')).toEqual([
        expected.summaryTotal
      ]);
      expect(
        attached.diagnostics().filter((d) => d.severity === 'error')
      ).toEqual([]);

      const out = process.env.DOCX_FIXTURE_OUT;
      if (out) {
        const tokens = makeRealDocumentEditor(buildBandedProposalTokens());
        try {
          const bytes = await blobBytes(
            await (tokens as any).saveAsBlob('Docx')
          );
          mkdirSync(dirname(out), { recursive: true });
          writeFileSync(out, bytes);
        } finally {
          destroyRealDocumentEditor(tokens);
        }
      }
    } finally {
      attached.dispose();
      destroyRealDocumentEditor(editor);
    }
  });
});
