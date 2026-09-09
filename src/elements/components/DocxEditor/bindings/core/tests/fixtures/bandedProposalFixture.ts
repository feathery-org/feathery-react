// A banded bound schedule with mixed row roles, an unbound fees table, a
// cross-table summary and a spanning bookmark, figures computed here not typed
import { convertTemplateTokens } from '../../templateImport';
import { SfdtDocument } from '../../sfdtTypes';
import { renderDisplay } from '../../valueTypes';

export const HEADER_FILL = '#1F3864';
export const BAND_FILLS = ['#FFFFFF', '#E8E8E8'];
export const AGGREGATE_FILL = '#D9E2F3';
export const TOTAL_FILL = '#B4C6E7';
export const SPANNING_BOOKMARK = 'schedule_core_lines';

const CURRENCY = { kind: 'currency', currency: 'USD', scale: 2 } as const;
const TAX_RATE = '0.08';

export const SCHEDULE_ITEMS = [
  { item: 'General Liability', quantity: 1, unitCost: '2450.00' },
  { item: 'Commercial Property', quantity: 2, unitCost: '1875.50' },
  { item: 'Business Auto', quantity: 3, unitCost: '1210.00' },
  { item: 'Umbrella', quantity: 1, unitCost: '980.00' },
  { item: 'Workers Compensation', quantity: 4, unitCost: '640.25' },
  { item: 'Cyber Liability', quantity: 1, unitCost: '1325.00' }
];

const cents = (value: string) => Math.round(Number(value) * 100);
const money = (centsValue: number) =>
  renderDisplay(CURRENCY, (centsValue / 100).toFixed(2));

const lineTotals = SCHEDULE_ITEMS.map(
  (row) => row.quantity * cents(row.unitCost)
);
const subtotalCents = lineTotals.reduce((sum, value) => sum + value, 0);
const taxCents = Math.round(subtotalCents * Number(TAX_RATE));

/** The figures the document must show after its first reconcile */
export const BANDED_PROPOSAL_EXPECTED = {
  lineTotals: lineTotals.map(money),
  scheduleSubtotal: money(subtotalCents),
  scheduleTax: money(taxCents),
  scheduleTotal: money(subtotalCents + taxCents),
  summaryProperty: money(subtotalCents),
  summaryTax: money(taxCents),
  summaryTotal: money(subtotalCents + taxCents),
  /** What the schedule reads once the rows at these indices are removed */
  subtotalWithout(itemIndices: number[]): string {
    const kept = lineTotals.filter((_, index) => !itemIndices.includes(index));
    return money(kept.reduce((sum, value) => sum + value, 0));
  }
};

/* ---------------- SFDT builders ---------------- */

const run = (text: string, characterFormat: Record<string, unknown> = {}) => ({
  characterFormat,
  text
});
const para = (inlines: unknown[], textAlignment = 'Left') => ({
  paragraphFormat: { textAlignment },
  characterFormat: {},
  inlines
});
const cell = (
  inlines: unknown[],
  width: number,
  options: { fill?: string; columnSpan?: number; align?: string } = {}
) => ({
  blocks: [para(inlines, options.align ?? 'Left')],
  cellFormat: {
    preferredWidth: width,
    preferredWidthType: 'Point',
    cellWidth: width,
    columnSpan: options.columnSpan ?? 1,
    rowSpan: 1,
    ...(options.fill
      ? {
          shading: {
            texture: 'TextureNone',
            backgroundColor: options.fill,
            foregroundColor: 'empty'
          }
        }
      : {})
  }
});
const row = (cells: unknown[], isHeader = false) => ({
  rowFormat: {
    height: 0,
    heightType: 'Auto',
    gridBefore: 0,
    gridAfter: 0,
    allowBreakAcrossPages: true,
    isHeader
  },
  cells
});
const table = (rows: unknown[]) => ({
  tableFormat: {
    borders: {},
    preferredWidth: 468,
    preferredWidthType: 'Point',
    leftIndent: 0
  },
  rows
});

const HEADER_TEXT = { bold: true, fontColor: '#FFFFFF' };
const BOLD = { bold: true };
const WIDTHS = [190, 60, 108, 110];

function scheduleTable() {
  const groupHeader = row(
    [
      cell([run('Coverage', HEADER_TEXT)], WIDTHS[0], { fill: HEADER_FILL }),
      cell([run('Premium basis', HEADER_TEXT)], 278, {
        fill: HEADER_FILL,
        columnSpan: 3,
        align: 'Center'
      })
    ],
    true
  );
  const columnHeader = row(
    [
      cell([run('Line of business', HEADER_TEXT)], WIDTHS[0], {
        fill: HEADER_FILL
      }),
      cell([run('Units', HEADER_TEXT)], WIDTHS[1], {
        fill: HEADER_FILL,
        align: 'Right'
      }),
      cell([run('Rate', HEADER_TEXT)], WIDTHS[2], {
        fill: HEADER_FILL,
        align: 'Right'
      }),
      cell([run('Premium', HEADER_TEXT)], WIDTHS[3], {
        fill: HEADER_FILL,
        align: 'Right'
      })
    ],
    true
  );
  const items = SCHEDULE_ITEMS.map((entry, index) => {
    const fill = BAND_FILLS[index % 2];
    // The bookmark spans the first three items, a cut between them tears it
    const open =
      index === 0 ? [{ bookmarkType: 0, name: SPANNING_BOOKMARK }] : [];
    const close =
      index === 2 ? [{ bookmarkType: 1, name: SPANNING_BOOKMARK }] : [];
    return row([
      cell(
        [...open, run(`[[name=item|default=${entry.item}|row=auto]]`)],
        WIDTHS[0],
        { fill }
      ),
      cell(
        [
          run(
            `[[name=quantity|type=integer|default=${entry.quantity}|row=auto]]`
          )
        ],
        WIDTHS[1],
        { fill, align: 'Right' }
      ),
      cell(
        [
          run(
            `[[name=unit_cost|type=currency|default=${entry.unitCost}|row=auto]]`
          )
        ],
        WIDTHS[2],
        { fill, align: 'Right' }
      ),
      cell(
        [
          run(
            '[[name=line_total|type=currency|expr=mul(quantity,unit_cost)|row=auto]]'
          ),
          ...close
        ],
        WIDTHS[3],
        { fill, align: 'Right' }
      )
    ]);
  });
  const aggregate = (label: string, token: string, fill: string) =>
    row([
      cell([run(label, BOLD)], 358, { fill, columnSpan: 3 }),
      cell([run(token, BOLD)], WIDTHS[3], { fill, align: 'Right' })
    ]);
  return table([
    groupHeader,
    columnHeader,
    ...items,
    aggregate(
      'Subtotal',
      '[[name=schedule_subtotal|type=currency|expr=sum(schedule.line_total)]]',
      AGGREGATE_FILL
    ),
    aggregate(
      'Tax',
      '[[name=schedule_tax|type=currency|expr=mul(schedule_subtotal,tax_rate)]]',
      AGGREGATE_FILL
    ),
    aggregate(
      'Total',
      '[[name=schedule_total|type=currency|expr=sum(schedule_subtotal,schedule_tax)]]',
      TOTAL_FILL
    )
  ]);
}

function feesTable() {
  return table([
    row(
      [
        cell([run('Fee', HEADER_TEXT)], 300, { fill: HEADER_FILL }),
        cell([run('Amount', HEADER_TEXT)], 168, {
          fill: HEADER_FILL,
          align: 'Right'
        })
      ],
      true
    ),
    row([
      cell([run('Broker fee')], 300),
      cell([run('$250.00')], 168, { align: 'Right' })
    ]),
    row([
      cell([run('Policy fee')], 300),
      cell([run('$75.00')], 168, { align: 'Right' })
    ]),
    row([
      cell([run('Inspection fee')], 300),
      cell([run('$125.00')], 168, { align: 'Right' })
    ]),
    row([
      cell(
        [run('Fees are due with the first installment and are fully earned.')],
        468,
        {
          columnSpan: 2
        }
      )
    ])
  ]);
}

function summaryTable() {
  const line = (label: string, token: string, fill?: string) =>
    row([
      cell([run(label, fill ? BOLD : {})], 300, { fill }),
      cell([run(token, fill ? BOLD : {})], 168, { fill, align: 'Right' })
    ]);
  return table([
    row(
      [
        cell([run('Summary', HEADER_TEXT)], 300, { fill: HEADER_FILL }),
        cell([run('Annual', HEADER_TEXT)], 168, {
          fill: HEADER_FILL,
          align: 'Right'
        })
      ],
      true
    ),
    line(
      'Property and casualty',
      '[[name=summary_property|type=currency|expr=schedule_subtotal]]'
    ),
    line(
      'Tax',
      '[[name=summary_tax|type=currency|expr=mul(schedule_subtotal,tax_rate)]]'
    ),
    line(
      'Total annual premium',
      '[[name=summary_total|type=currency|expr=sum(schedule_subtotal,summary_tax)]]',
      TOTAL_FILL
    )
  ]);
}

/** The document as a template author writes it, tokens as plain text */
export function buildBandedProposalTokens(): SfdtDocument {
  return {
    sections: [
      {
        sectionFormat: {
          pageWidth: 612,
          pageHeight: 792,
          leftMargin: 72,
          rightMargin: 72,
          topMargin: 72,
          bottomMargin: 72
        },
        headersFooters: {},
        blocks: [
          para([
            run('Commercial Insurance Proposal', { bold: true, fontSize: 18 })
          ]),
          para([
            run('Prepared for '),
            run('[[name=client_name|default=Northwind Traders LLC]]'),
            run(' at a tax rate of '),
            run(
              `[[name=tax_rate|type=percent|default=${
                Number(TAX_RATE) * 100
              }%]]`
            ),
            run('.')
          ]),
          para([run('Coverage schedule', { bold: true, fontSize: 14 })]),
          para([run('[[table=schedule]]')]),
          scheduleTable(),
          para([]),
          para([run('Fees', { bold: true, fontSize: 14 })]),
          feesTable(),
          para([]),
          para([run('Premium summary', { bold: true, fontSize: 14 })]),
          summaryTable(),
          para([run('Figures above are subject to carrier approval.')])
        ]
      }
    ]
  } as unknown as SfdtDocument;
}

/** The same document with its tokens materialized as content controls */
export function buildBandedProposalFixture(): SfdtDocument {
  const converted = convertTemplateTokens(buildBandedProposalTokens());
  const errors = converted.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length)
    throw new Error(
      `banded proposal tokens did not convert: ${errors
        .map((d) => d.message)
        .join('; ')}`
    );
  return converted.sfdt;
}
