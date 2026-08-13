// Builds the "project costs" demo document used across the binding specs:
//   - document-level field project.name used twice in prose
//   - document-level field tax_rate living inside the HEADER CELLS of two
//     different tables (editing either header updates the other)
//   - configured table "costs": bound inputs + row formula + aggregate
//   - configured table "expenses": bound inputs + aggregate
//   - combined_total = sum(grand_total, expenses_total) across both tables
//
// Every tag is produced by formatTag, so the document is canonical by
// construction - which is what lets the specs assert byte-exact tags.
import { formatTag, FieldType } from '../../tagDsl';
import {
  ContentControlProperties,
  SfdtBlock,
  SfdtCell,
  SfdtDocument,
  SfdtInline,
  SfdtRow
} from '../../sfdtTypes';

const CURRENCY: FieldType = { kind: 'currency', currency: 'USD', scale: 2 };

function ccProps(
  tag: string,
  title: string,
  locked: boolean
): ContentControlProperties {
  return {
    lockContentControl: true,
    lockContents: !!locked,
    tag,
    title,
    type: 'Text',
    hasPlaceHolderText: false,
    multiline: false,
    isTemporary: false,
    // Mandatory: the border renderer measures this the moment the caret enters.
    color: '#00000000',
    appearance: 'BoundingBox'
  };
}

function fieldTag(
  name: string,
  fieldType: FieldType,
  rowId: string | null
): string {
  return formatTag({
    version: 2,
    kind: 'field',
    name,
    fieldType,
    isEditable: true,
    isDeletable: true,
    options: rowId ? { row: rowId } : {}
  });
}

function formulaTag(
  name: string,
  fieldType: FieldType,
  expression: string,
  rowId: string | null
): string {
  return formatTag({
    version: 2,
    kind: 'formula',
    name,
    fieldType,
    expression,
    isEditable: false,
    isDeletable: false,
    options: rowId ? { row: rowId } : {}
  });
}

function cc(
  tag: string,
  title: string,
  locked: boolean,
  text: string,
  characterFormat?: Record<string, unknown>
): SfdtInline {
  const run: SfdtInline = { text };
  if (characterFormat) run.characterFormat = characterFormat;
  return { contentControlProperties: ccProps(tag, title, locked), inlines: [run] };
}

function headerCellInlines(
  inlines: SfdtInline[],
  width: number,
  align = 'Right'
): SfdtCell {
  return {
    blocks: [
      {
        paragraphFormat: {
          leftIndent: 0,
          firstLineIndent: 0,
          textAlignment: align
        },
        inlines
      }
    ],
    cellFormat: {
      shading: {
        texture: 'TextureNone',
        backgroundColor: '#1F3864',
        foregroundColor: 'empty'
      },
      preferredWidth: width,
      preferredWidthType: 'Point',
      cellWidth: width,
      columnSpan: 1,
      rowSpan: 1,
      verticalAlignment: 'Center'
    },
    columnIndex: 0
  };
}

const HEADER_CF = { bold: true, fontColor: '#FFFFFF' };

function headerCell(text: string, width: number): SfdtCell {
  return headerCellInlines(
    [{ characterFormat: HEADER_CF, text }],
    width,
    text === 'Item' || text === 'Expense' ? 'Left' : 'Right'
  );
}

/**
 * The shared header field: one document-level NUMBER whose occurrences live
 * inside the header cells of BOTH tables. Canonical value is the fraction
 * ("8%" -> 0.08). Editable anywhere, but no header can delete it.
 */
function taxRateCc(title: string): SfdtInline {
  const tag = formatTag({
    version: 2,
    kind: 'field',
    name: 'tax_rate',
    fieldType: { kind: 'percent' },
    isEditable: true,
    isDeletable: false,
    options: {}
  });
  return cc(tag, title, false, '0%', HEADER_CF);
}

interface BodyCellOptions {
  columnSpan?: number;
  shaded?: boolean;
  align?: string;
}

function bodyCell(
  inlines: SfdtInline[],
  width: number,
  options: BodyCellOptions = {}
): SfdtCell {
  const cellFormat: Record<string, unknown> = {
    preferredWidth: width,
    preferredWidthType: 'Point',
    cellWidth: width,
    columnSpan: options.columnSpan || 1,
    rowSpan: 1
  };
  if (options.shaded)
    cellFormat.shading = {
      texture: 'TextureNone',
      backgroundColor: '#EEF6EE',
      foregroundColor: 'empty'
    };
  return {
    blocks: [
      {
        paragraphFormat: {
          leftIndent: 0,
          firstLineIndent: 0,
          textAlignment: options.align || 'Right'
        },
        inlines
      }
    ],
    cellFormat,
    columnIndex: 0
  };
}

const DATA_ROW_FORMAT = {
  height: 0,
  heightType: 'Auto',
  gridBefore: 0,
  gridAfter: 0,
  allowBreakAcrossPages: true,
  isHeader: false
};

const HEADER_ROW_FORMAT = {
  height: 22,
  heightType: 'AtLeast',
  gridBefore: 0,
  gridAfter: 0,
  allowBreakAcrossPages: false,
  isHeader: true
};

function dataRow(
  rowId: string,
  item: string,
  qtyText: string,
  unitText: string,
  totalText: string
): SfdtRow {
  return {
    cells: [
      bodyCell(
        [cc(fieldTag('item', { kind: 'text' }, rowId), 'Item', false, item)],
        170,
        { align: 'Left' }
      ),
      bodyCell(
        [
          cc(
            fieldTag('quantity', { kind: 'integer' }, rowId),
            'Qty',
            false,
            qtyText
          )
        ],
        60
      ),
      bodyCell(
        [cc(fieldTag('unit_cost', CURRENCY, rowId), 'Unit price', false, unitText)],
        100
      ),
      bodyCell(
        [
          cc(
            formulaTag('line_total', CURRENCY, 'mul(quantity,unit_cost)', rowId),
            'Line total',
            true,
            totalText
          )
        ],
        110,
        { shaded: true }
      )
    ],
    rowFormat: DATA_ROW_FORMAT
  };
}

export const GRAND_TOTAL_TAG = (): string =>
  formulaTag('grand_total', CURRENCY, 'sum(costs_subtotal,costs_tax)', null);

/**
 * Subtotal / Tax / Total summary rows share one shape: a spanned label cell and
 * a locked calculated cell in the amounts column.
 */
function summaryRow(
  label: string,
  ccNode: SfdtInline,
  labelWidth: number,
  valueWidth: number,
  span: number
): SfdtRow {
  return {
    cells: [
      bodyCell([{ characterFormat: { bold: true }, text: label }], labelWidth, {
        columnSpan: span
      }),
      bodyCell([ccNode], valueWidth, { shaded: true })
    ],
    rowFormat: DATA_ROW_FORMAT
  };
}

function expenseRow(
  rowId: string,
  label: string,
  amountText: string
): SfdtRow {
  return {
    cells: [
      bodyCell(
        [cc(fieldTag('expense', { kind: 'text' }, rowId), 'Expense', false, label)],
        250,
        { align: 'Left' }
      ),
      bodyCell(
        [cc(fieldTag('amount', CURRENCY, rowId), 'Amount', false, amountText)],
        130
      )
    ],
    rowFormat: DATA_ROW_FORMAT
  };
}

const TABLE_BORDERS = {
  top: { lineStyle: 'Single', lineWidth: 0.5 },
  left: { lineStyle: 'Single', lineWidth: 0.5 },
  right: { lineStyle: 'Single', lineWidth: 0.5 },
  bottom: { lineStyle: 'Single', lineWidth: 0.5 },
  horizontal: { lineStyle: 'Single', lineWidth: 0.5 },
  vertical: { lineStyle: 'Single', lineWidth: 0.5 }
};

const TABLE_FORMAT = {
  borders: TABLE_BORDERS,
  leftIndent: 0,
  topMargin: 0,
  bottomMargin: 0,
  leftMargin: 5.4,
  rightMargin: 5.4,
  preferredWidthType: 'Auto',
  tableAlignment: 'Left',
  bidi: false
};

function buildExpensesTable(): SfdtBlock {
  return {
    rows: [
      {
        cells: [
          headerCell('Expense', 250),
          headerCellInlines(
            [
              { characterFormat: HEADER_CF, text: 'Amount — tax ' },
              taxRateCc('Tax rate (expenses header)')
            ],
            130
          )
        ],
        rowFormat: HEADER_ROW_FORMAT
      },
      expenseRow('e-1', 'Travel', '$500.00'),
      expenseRow('e-2', 'Software licenses', '$1,200.00'),
      summaryRow(
        'Subtotal',
        cc(
          formulaTag('expenses_subtotal', CURRENCY, 'sum(expenses.amount)', null),
          'Expenses subtotal',
          true,
          '$1,700.00'
        ),
        250,
        130,
        1
      ),
      summaryRow(
        'Tax',
        cc(
          formulaTag(
            'expenses_tax',
            CURRENCY,
            'mul(expenses_subtotal,tax_rate)',
            null
          ),
          'Expenses tax',
          true,
          '$0.00'
        ),
        250,
        130,
        1
      ),
      summaryRow(
        'Expenses total',
        cc(
          formulaTag(
            'expenses_total',
            CURRENCY,
            'sum(expenses_subtotal,expenses_tax)',
            null
          ),
          'Expenses total',
          true,
          '$1,700.00',
          { bold: true }
        ),
        250,
        130,
        1
      )
    ],
    grid: [250, 130],
    tableFormat: TABLE_FORMAT,
    columnCount: 2
  };
}

export function buildCostsFixture(): SfdtDocument {
  const table: SfdtBlock = {
    rows: [
      {
        cells: [
          headerCell('Item', 170),
          headerCell('Qty', 60),
          headerCell('Unit price', 100),
          headerCellInlines(
            [
              { characterFormat: HEADER_CF, text: 'Line total — tax ' },
              taxRateCc('Tax rate (costs header)')
            ],
            130
          )
        ],
        rowFormat: HEADER_ROW_FORMAT
      },
      dataRow('r-1', 'Design work', '12', '$150.00', '$1,800.00'),
      dataRow('r-2', 'Development', '30', '$200.00', '$6,000.00'),
      summaryRow(
        'Subtotal',
        cc(
          formulaTag('costs_subtotal', CURRENCY, 'sum(costs.line_total)', null),
          'Costs subtotal',
          true,
          '$7,800.00'
        ),
        330,
        110,
        3
      ),
      summaryRow(
        'Tax',
        cc(
          formulaTag('costs_tax', CURRENCY, 'mul(costs_subtotal,tax_rate)', null),
          'Costs tax',
          true,
          '$0.00'
        ),
        330,
        110,
        3
      ),
      summaryRow(
        'Total',
        cc(GRAND_TOTAL_TAG(), 'Grand total', true, '$7,800.00', { bold: true }),
        330,
        110,
        3
      )
    ],
    grid: [170, 60, 100, 110],
    tableFormat: TABLE_FORMAT,
    columnCount: 4
  };

  return {
    optimizeSfdt: false,
    sections: [
      {
        sectionFormat: {
          pageWidth: 612,
          pageHeight: 792,
          leftMargin: 72,
          rightMargin: 72,
          topMargin: 72,
          bottomMargin: 72,
          headerDistance: 36,
          footerDistance: 36,
          differentFirstPage: false,
          differentOddAndEvenPages: false,
          bidi: false,
          breakCode: 'NewPage',
          pageNumberStyle: 'Arabic',
          numberOfColumns: 1,
          equalWidth: true,
          lineBetweenColumns: false,
          columns: []
        },
        blocks: [
          {
            paragraphFormat: { styleName: 'Heading 1', afterSpacing: 10 },
            inlines: [{ text: 'Project cost estimate' }]
          },
          {
            paragraphFormat: { afterSpacing: 10 },
            inlines: [
              { text: 'Project: ' },
              cc(
                fieldTag('project.name', { kind: 'text' }, null),
                'Project name',
                false,
                'Website relaunch'
              ),
              { text: '    Prepared: 2026-08-11' }
            ]
          },
          {
            contentControlProperties: {
              lockContentControl: true,
              lockContents: false,
              tag: formatTag({ version: 2, kind: 'table', tableId: 'costs' }),
              title: 'Costs table',
              type: 'RichText',
              hasPlaceHolderText: false,
              multiline: false,
              isTemporary: false,
              color: '#00000000',
              appearance: 'BoundingBox'
            },
            blocks: [table]
          },
          { paragraphFormat: { afterSpacing: 8 }, inlines: [] },
          {
            paragraphFormat: { afterSpacing: 8 },
            inlines: [
              { text: 'Amount due for ' },
              cc(
                fieldTag('project.name', { kind: 'text' }, null),
                'Project name (repeat)',
                false,
                'Website relaunch'
              ),
              { text: ': ' },
              cc(GRAND_TOTAL_TAG(), 'Grand total (repeat)', true, '$7,800.00'),
              { text: '.' }
            ]
          },
          {
            paragraphFormat: { styleName: 'Heading 1', afterSpacing: 10 },
            inlines: [{ text: 'Expenses' }]
          },
          {
            contentControlProperties: {
              lockContentControl: true,
              lockContents: false,
              tag: formatTag({ version: 2, kind: 'table', tableId: 'expenses' }),
              title: 'Expenses table',
              type: 'RichText',
              hasPlaceHolderText: false,
              multiline: false,
              isTemporary: false,
              color: '#00000000',
              appearance: 'BoundingBox'
            },
            blocks: [buildExpensesTable()]
          },
          { paragraphFormat: { afterSpacing: 8 }, inlines: [] },
          {
            paragraphFormat: { afterSpacing: 8 },
            inlines: [
              { text: 'Combined total (costs + expenses): ' },
              cc(
                formulaTag(
                  'combined_total',
                  CURRENCY,
                  'sum(grand_total,expenses_total)',
                  null
                ),
                'Combined total',
                true,
                '$9,500.00',
                { bold: true }
              ),
              { text: '.' }
            ]
          },
          { inlines: [] }
        ]
      }
    ],
    characterFormat: {
      bold: false,
      italic: false,
      fontSize: 11,
      fontFamily: 'Calibri',
      underline: 'None',
      strikethrough: 'None',
      baselineAlignment: 'Normal',
      highlightColor: 'NoColor',
      fontSizeBidi: 11,
      fontFamilyBidi: 'Calibri',
      allCaps: false,
      fontFamilyAscii: 'Calibri',
      fontFamilyNonFarEast: 'Calibri'
    },
    paragraphFormat: {
      leftIndent: 0,
      rightIndent: 0,
      firstLineIndent: 0,
      textAlignment: 'Left',
      beforeSpacing: 0,
      afterSpacing: 0,
      lineSpacing: 1,
      lineSpacingType: 'Multiple',
      outlineLevel: 'BodyText',
      bidi: false,
      keepLinesTogether: false,
      keepWithNext: false,
      widowControl: true
    },
    fontSubstitutionTable: {},
    themeFontLanguages: {},
    defaultTabWidth: 36,
    trackChanges: false,
    enforcement: false,
    hashValue: '',
    saltValue: '',
    formatting: false,
    protectionType: 'NoProtection',
    dontUseHTMLParagraphAutoSpacing: false,
    formFieldShading: true,
    compatibilityMode: 'Word2013',
    allowSpaceOfSameStyleInTable: false,
    background: { color: '#FFFFFF' },
    styles: [
      { name: 'Normal', type: 'Paragraph', next: 'Normal' },
      {
        name: 'Heading 1',
        type: 'Paragraph',
        paragraphFormat: {
          beforeSpacing: 12,
          afterSpacing: 0,
          outlineLevel: 'Level1'
        },
        characterFormat: {
          fontSize: 16,
          fontFamily: 'Calibri Light',
          fontColor: '#2F5496',
          fontFamilyAscii: 'Calibri Light',
          fontFamilyNonFarEast: 'Calibri Light'
        },
        basedOn: 'Normal',
        link: 'Heading 1 Char',
        next: 'Normal'
      },
      {
        name: 'Heading 1 Char',
        type: 'Character',
        characterFormat: {
          fontSize: 16,
          fontFamily: 'Calibri Light',
          fontColor: '#2F5496',
          fontFamilyAscii: 'Calibri Light',
          fontFamilyNonFarEast: 'Calibri Light'
        },
        basedOn: 'Default Paragraph Font'
      },
      { name: 'Default Paragraph Font', type: 'Character' }
    ],
    lists: [],
    abstractLists: [],
    comments: [],
    revisions: [],
    customXml: [],
    images: {}
  };
}
