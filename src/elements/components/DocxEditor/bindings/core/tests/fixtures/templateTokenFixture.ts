// The costs document as an author writes it: [[...]] tokens in plain text, no
// content controls yet. This is what a converted .docx looks like on arrival
// from the Word Processor service, and what convertTemplateTokens consumes.
//
// It exists because the POC proved template import against its own mini docx
// reader, which is not ported (feathery-react converts .docx server side). The
// document below carries the same bindings and defaults as that template, so the
// import assertions survive without the reader.
//
// Deliberately sparse on formatting: import only reads text, tables and runs.
import { SfdtBlock, SfdtCell, SfdtDocument, SfdtRow } from '../../sfdtTypes';

const para = (text: string): SfdtBlock => ({
  paragraphFormat: {},
  inlines: [{ text }]
});

/** A paragraph whose text is deliberately split across runs, as Word resaves. */
const splitPara = (...texts: string[]): SfdtBlock => ({
  paragraphFormat: {},
  inlines: texts.map((text) => ({ text }))
});

const cell = (text: string): SfdtCell => ({
  cellFormat: {},
  blocks: [para(text)]
});

const row = (...texts: string[]): SfdtRow => ({
  rowFormat: { isHeader: false },
  cells: texts.map(cell)
});

const headerRow = (...texts: string[]): SfdtRow => ({
  rowFormat: { isHeader: true },
  cells: texts.map(cell)
});

const TAX_RATE_TOKEN =
  '[[name=tax_rate|type=percent|del=keep|default=0%]]';

const costsTable = (): SfdtBlock => ({
  tableFormat: {},
  columnCount: 4,
  rows: [
    headerRow('Item', 'Qty', 'Unit price', `Line total — tax ${TAX_RATE_TOKEN}`),
    row(
      '[[name=item|default=Design work|row=auto]]',
      '[[name=quantity|type=integer|default=12|row=auto]]',
      '[[name=unit_cost|type=currency|default=150|row=auto]]',
      '[[name=line_total|expr=mul(quantity,unit_cost)|row=auto]]'
    ),
    row(
      '[[name=item|default=Development|row=auto]]',
      '[[name=quantity|type=integer|default=30|row=auto]]',
      '[[name=unit_cost|type=currency|default=200|row=auto]]',
      '[[name=line_total|expr=mul(quantity,unit_cost)|row=auto]]'
    ),
    row('Subtotal', '', '', '[[name=costs_subtotal|expr=sum(costs.line_total)]]'),
    row('Tax', '', '', '[[name=costs_tax|expr=mul(costs_subtotal,tax_rate)]]'),
    row(
      'Total',
      '',
      '',
      '[[name=grand_total|expr=sum(costs_subtotal,costs_tax)]]'
    )
  ]
});

const expensesTable = (): SfdtBlock => ({
  tableFormat: {},
  columnCount: 2,
  rows: [
    headerRow('Expense', `Amount — tax ${TAX_RATE_TOKEN}`),
    row(
      '[[name=expense|default=Travel|row=auto]]',
      '[[name=amount|type=currency|default=500|row=auto]]'
    ),
    row(
      '[[name=expense|default=Software licenses|row=auto]]',
      '[[name=amount|type=currency|default=1200|row=auto]]'
    ),
    row('Subtotal', '[[name=expenses_subtotal|expr=sum(expenses.amount)]]'),
    row('Tax', '[[name=expenses_tax|expr=mul(expenses_subtotal,tax_rate)]]'),
    row(
      'Expenses total',
      '[[name=expenses_total|expr=sum(expenses_subtotal,expenses_tax)]]'
    )
  ]
});

export function buildTemplateTokenDocument(): SfdtDocument {
  return {
    sections: [
      {
        blocks: [
          para('Project cost estimate'),
          // The project name is split across runs on purpose: a resaved Word
          // template routinely breaks a token mid-string, and import has to
          // splice it back together.
          splitPara(
            'Project: [[name=',
            'project.name|default=Website',
            ' relaunch]]'
          ),
          para('[[table=costs]]'),
          costsTable(),
          para(
            'Amount due for [[name=project.name|default=Website relaunch]]: [[name=grand_total|expr=sum(costs_subtotal,costs_tax)]].'
          ),
          para('Expenses'),
          para('[[table=expenses]]'),
          expensesTable(),
          para(
            'Combined total (costs + expenses): [[name=combined_total|expr=sum(grand_total,expenses_total)]].'
          )
        ]
      }
    ]
  };
}
