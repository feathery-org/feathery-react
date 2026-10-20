// Bindings inside a text box (a shape's textFrame) must convert, scan, and
// compute like body bindings. Syncfusion serializes a text box as an inline
// carrying `textFrame.blocks`; earlier the engine never descended there, so a
// token in a text box stayed raw in the editor while the server-side strip
// resolved it — a confusing asymmetry this exercises end to end.
import { applyRules } from '../engine';
import { scanBindings } from '../sfdtAdapter';
import { convertTemplateTokens } from '../templateImport';
import { SfdtDocument } from '../sfdtTypes';

// A body with a plain field paragraph and a paragraph hosting a text box whose
// inner paragraph holds a formula token plus trailing text.
function docWithTextBox(): SfdtDocument {
  return {
    sections: [
      {
        blocks: [
          {
            inlines: [
              { text: 'Subtotal: ' },
              { text: '[[name=subtotal|type=currency|value=100]]' }
            ]
          },
          {
            inlines: [
              { text: 'Callout: ' },
              {
                textFrame: {
                  blocks: [
                    {
                      inlines: [
                        {
                          text: 'Tax due: [[name=tax|type=currency|expr=mul(subtotal,0.1)]] end'
                        }
                      ]
                    }
                  ]
                }
              } as any
            ]
          }
        ]
      }
    ]
  } as SfdtDocument;
}

// Same shape, but the shape is anchored on the paragraph via floatingElements
// rather than sitting in its inlines.
function docWithFloatingTextBox(): SfdtDocument {
  return {
    sections: [
      {
        blocks: [
          {
            inlines: [{ text: '[[name=subtotal|type=currency|value=100]]' }],
            floatingElements: [
              {
                textFrame: {
                  blocks: [
                    {
                      inlines: [
                        {
                          text: '[[name=tax|type=currency|expr=mul(subtotal,0.1)]]'
                        }
                      ]
                    }
                  ]
                }
              }
            ]
          } as any
        ]
      }
    ]
  } as SfdtDocument;
}

function taxOccurrence(sfdt: SfdtDocument) {
  const index = scanBindings(sfdt);
  expect(index.diagnostics).toEqual([]);
  const tax = index.occurrences.find((o) => o.name === 'tax');
  expect(tax).toBeDefined();
  return { index, tax: tax! };
}

describe('text box (textFrame) bindings', () => {
  it('converts a token inside a text box into a content control', () => {
    const { sfdt, diagnostics } = convertTemplateTokens(docWithTextBox());
    expect(diagnostics).toEqual([]);
    const json = JSON.stringify(sfdt);
    // Token became a control (its tag keeps the token, like body controls) and
    // is gone from the visible run text; trailing text survives (not truncated).
    expect(json).toContain('"tag":"[[name=tax');
    expect(json).not.toContain('Tax due: [[name=tax');
    expect(json).toContain('" end"');
  });

  it('scans a binding nested in a text box with a path through textFrame', () => {
    const { sfdt } = convertTemplateTokens(docWithTextBox());
    const { tax } = taxOccurrence(sfdt);
    expect(tax.def.kind).toBe('formula');
    expect(tax.path).toContain('textFrame');
  });

  it('computes a formula in a text box from a doc-level field', () => {
    const { sfdt } = convertTemplateTokens(docWithTextBox());
    const result = applyRules(sfdt);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      []
    );
    const { tax } = taxOccurrence(result.sfdt);
    // mul(subtotal=100, 0.1) -> $10.00, rendered inside the text box.
    expect(tax.text).toBe('$10.00');
  });

  it('handles a floating text box anchored on the paragraph', () => {
    const { sfdt } = convertTemplateTokens(docWithFloatingTextBox());
    const result = applyRules(sfdt);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      []
    );
    const { tax } = taxOccurrence(result.sfdt);
    expect(tax.text).toBe('$10.00');
  });
});
