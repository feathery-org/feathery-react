// Ported from the POC's test/template-import.test.js. The four cases that drove
// a real .docx through the POC's mini zip/XML reader now run against
// buildTemplateTokenDocument instead - same bindings, same defaults, same
// assertions - because feathery-react converts .docx server side and that reader
// is not part of the port. The three reader-independent cases are unchanged.
import { applyRules, hasBlockingErrors } from '../engine';
import { scanBindings, setOccurrenceText } from '../sfdtAdapter';
import { convertTemplateTokens } from '../templateImport';
import { buildTemplateTokenDocument } from './fixtures/templateTokenFixture';

const importTemplate = () =>
  convertTemplateTokens(buildTemplateTokenDocument());

describe('convertTemplateTokens', () => {
  it('starts from plain tokens with no content controls', () => {
    const base = buildTemplateTokenDocument();
    const text = JSON.stringify(base);
    expect(text).toContain('[[table=costs]]');
    expect(text).toContain('[[name=quantity|type=integer|default=12|row=auto]]');
    expect(text).not.toContain('contentControlProperties');
    expect(
      (base.sections![0].blocks || []).filter((block) =>
        Array.isArray(block.rows)
      )
    ).toHaveLength(2);
  });

  it('produces the same binding shape as the hand-built fixture', () => {
    const { sfdt, diagnostics } = importTemplate();
    expect(diagnostics).toEqual([]);
    // Marker PARAGRAPHS are consumed; the wrapper control's tag keeps the token.
    expect(JSON.stringify(sfdt)).not.toContain('"text":"[[table=');

    const index = scanBindings(sfdt);
    expect(index.diagnostics).toEqual([]);
    expect([...index.tables.keys()].sort()).toEqual(['costs', 'expenses']);

    // Data rows got distinct fresh identities; summary rows stay doc-level.
    const costs = index.tables.get('costs')!;
    expect(costs.rows).toHaveLength(2);
    expect(costs.rows[0].rowId).not.toBe(costs.rows[1].rowId);
    expect([...costs.rows[0].bindings.keys()].sort()).toEqual([
      'item',
      'line_total',
      'quantity',
      'unit_cost'
    ]);
    expect(index.tables.get('expenses')!.rows).toHaveLength(2);

    // The shared header field occurs in both tables' headers, doc-scoped.
    expect(index.fields.get('tax_rate')).toHaveLength(2);
    // Repeated formulas/fields in prose.
    expect(index.formulas.get('grand_total')).toHaveLength(2);
    expect(index.fields.get('project.name')).toHaveLength(2);
    // Formulas are locked and pending computation.
    for (const occurrence of index.occurrences.filter(
      (entry) => entry.def.kind === 'formula'
    )) {
      expect(occurrence.lockContents).toBe(true);
      expect(occurrence.text).toBe('…');
    }
  });

  it('computes every formula from the template defaults on first reconcile', () => {
    const { sfdt } = importTemplate();
    const result = applyRules(sfdt, {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);

    const rows = result.index.tables.get('costs')!.rows;
    expect(rows[0].bindings.get('unit_cost')!.text).toBe('$150.00');
    expect(rows[0].bindings.get('line_total')!.text).toBe('$1,800.00');
    expect(rows[1].bindings.get('line_total')!.text).toBe('$6,000.00');
    expect(result.index.formulas.get('costs_subtotal')![0].text).toBe(
      '$7,800.00'
    );
    expect(result.index.formulas.get('costs_tax')![0].text).toBe('$0.00');
    for (const grand of result.index.formulas.get('grand_total')!) {
      expect(grand.text).toBe('$7,800.00');
    }
    expect(result.index.formulas.get('expenses_total')![0].text).toBe(
      '$1,700.00'
    );
    expect(result.index.formulas.get('combined_total')![0].text).toBe(
      '$9,500.00'
    );
    for (const tax of result.index.fields.get('tax_rate')!) {
      expect(tax.text).toBe('0%');
    }
  });

  it('behaves like the fixture afterwards: edits recalculate', () => {
    const { sfdt } = importTemplate();
    const base = applyRules(sfdt, {});
    const quantity = base.index.tables
      .get('costs')!
      .rows[0].bindings.get('quantity')!;
    const next = setOccurrenceText(base.sfdt, quantity, '13');
    const result = applyRules(next, { prevValues: base.values });
    expect(
      result.index.tables.get('costs')!.rows[0].bindings.get('line_total')!.text
    ).toBe('$1,950.00');
    for (const grand of result.index.formulas.get('grand_total')!) {
      expect(grand.text).toBe('$7,950.00');
    }
    expect(result.index.formulas.get('combined_total')![0].text).toBe(
      '$9,650.00'
    );
  });

  it('is idempotent: converting twice changes nothing further', () => {
    // Phase 3 converts on open, and an open can happen more than once per
    // document, so a second pass must not double-wrap anything.
    const once = importTemplate();
    const twice = convertTemplateTokens(once.sfdt);
    expect(twice.converted).toBe(0);
    expect(twice.diagnostics).toEqual([]);
    expect(scanBindings(twice.sfdt).occurrences).toHaveLength(
      scanBindings(once.sfdt).occurrences.length
    );
  });

  it('leaves invalid tokens visible with diagnostics and converts the rest', () => {
    const base = {
      sections: [
        {
          blocks: [
            {
              paragraphFormat: {},
              inlines: [
                {
                  text: 'Good [[name=a]] bad [[name=b|nope=1]] plain [[not a token]]'
                }
              ]
            }
          ]
        }
      ]
    };
    const { sfdt, diagnostics, converted } = convertTemplateTokens(base);
    expect(converted).toBe(1);
    expect(diagnostics.some((entry) => entry.code === 'malformed-token')).toBe(
      true
    );
    const text = JSON.stringify(sfdt);
    expect(text).toContain('[[name=b|nope=1]]'); // left visible for fixing
    expect(text).toContain('[[not a token]]'); // foreign text untouched
    expect(text).toContain('contentControlProperties'); // [[name=a]] converted
  });

  it('converts tokens split across runs, Word-resave style', () => {
    const base = {
      sections: [
        {
          blocks: [
            {
              paragraphFormat: {},
              inlines: [
                { text: 'Tax: [[name=' },
                { text: 'tax_rate|type' },
                { text: '=' },
                { text: 'percent|default' },
                { text: '=0%]] end' }
              ]
            }
          ]
        }
      ]
    };
    const { sfdt, converted, diagnostics } = convertTemplateTokens(base);
    expect(converted).toBe(1);
    expect(diagnostics).toEqual([]);
    const paragraph = sfdt.sections![0].blocks![0];
    const control = (paragraph.inlines || []).find(
      (inline) => inline.contentControlProperties
    );
    expect(control).toBeDefined();
    expect(control!.contentControlProperties!.tag).toBe(
      '[[name=tax_rate|type=percent|default=0%25]]'
    );
    expect(control!.inlines![0].text).toBe('0%');
    expect(paragraph.inlines![0].text).toBe('Tax: ');
    expect(
      paragraph.inlines![paragraph.inlines!.length - 1].text
    ).toBe(' end');
  });

  it('treats a dangling table marker as a diagnostic, not a guess', () => {
    const base = {
      sections: [
        {
          blocks: [
            { paragraphFormat: {}, inlines: [{ text: '[[table=costs]]' }] }
          ]
        }
      ]
    };
    const { diagnostics } = convertTemplateTokens(base);
    expect(
      diagnostics.some((entry) => entry.code === 'dangling-table-marker')
    ).toBe(true);
  });
});
