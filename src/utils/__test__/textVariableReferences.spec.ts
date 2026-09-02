import { getTextVariableReferences } from '../hideAndRepeats';

// getAllElements yields [element, positionKey] pairs.
const elements = (...els: any[]): [any, string][] =>
  els.map((el, i) => [el, String(i)]);

describe('getTextVariableReferences', () => {
  it('returns an empty set for a step with no variables', () => {
    const refs = getTextVariableReferences(
      elements({ properties: { text: 'No variables here' } })
    );
    expect(refs.size).toBe(0);
  });

  it('collects variables from plain text', () => {
    const refs = getTextVariableReferences(
      elements({ properties: { text: 'Hi {{first_name}} and {{last_name}}' } })
    );
    expect([...refs].sort()).toEqual(['first_name', 'last_name']);
  });

  it('collects variables from rich-text delta inserts with no plain-text mirror', () => {
    // TextNodes interpolates text_formatted, so an allowlist over
    // properties.text alone would miss this.
    const refs = getTextVariableReferences(
      elements({
        properties: {
          text_formatted: [{ insert: 'Total: ' }, { insert: '{{amount}}' }]
        }
      })
    );
    expect([...refs]).toEqual(['amount']);
  });

  it('collects variables from font_link attributes', () => {
    const refs = getTextVariableReferences(
      elements({
        properties: {
          text_formatted: [
            { insert: 'click', attributes: { font_link: '/u/{{user_id}}' } }
          ]
        }
      })
    );
    expect([...refs]).toEqual(['user_id']);
  });

  it('collects variables from container tooltips, iframes and custom html', () => {
    const refs = getTextVariableReferences(
      elements(
        { properties: { tooltipText: 'for {{tip_key}}' } },
        { properties: { iframe_url: 'https://x.test?u={{iframe_key}}' } },
        { properties: { custom_html: '<b>{{html_key}}</b>' } }
      )
    );
    expect([...refs].sort()).toEqual(['html_key', 'iframe_key', 'tip_key']);
  });

  it('collects variables nested in matrix question metadata', () => {
    const refs = getTextVariableReferences(
      elements({
        servar: {
          type: 'matrix',
          metadata: {
            questions: [{ label: 'Rate {{product}}' }],
            options: ['{{option_key}}']
          }
        }
      })
    );
    expect([...refs].sort()).toEqual(['option_key', 'product']);
  });

  it('unions across elements and dedupes repeats', () => {
    const refs = getTextVariableReferences(
      elements(
        { properties: { text: '{{shared}} {{a}}' } },
        { properties: { text: '{{shared}} {{b}}' } }
      )
    );
    expect([...refs].sort()).toEqual(['a', 'b', 'shared']);
  });

  it('matches non-greedily so adjacent tokens stay separate', () => {
    const refs = getTextVariableReferences(
      elements({ properties: { text: '{{a}}{{b}}' } })
    );
    expect([...refs].sort()).toEqual(['a', 'b']);
  });

  it('tolerates null and undefined elements', () => {
    expect(getTextVariableReferences(elements(null, undefined)).size).toBe(0);
  });
});
