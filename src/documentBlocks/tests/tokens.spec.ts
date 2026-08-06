import { collectSpecs, resolveTokens, routeTokenEdit } from '../tokens';
import { SAMPLE_DOCUMENT } from '../sampleDocument';
import { DocumentData } from '../types';
import { FieldAccess, TokenValue } from '../../documentTokens/cycleTypes';

const stubFields = (
  values: Record<string, TokenValue>
): FieldAccess => ({
  read: (spec) => values[spec.source ?? spec.id],
  write: jest.fn()
});

describe('collectSpecs', () => {
  it('finds every value key in SAMPLE_DOCUMENT, one spec per value key even if a token appears twice', () => {
    const specs = collectSpecs(SAMPLE_DOCUMENT);
    const ids = specs.map((s) => s.id).sort();
    expect(ids).toEqual(['customer_name', 'retainer', 'total']);
  });

  it('does not duplicate a token that appears more than once', () => {
    const doc: DocumentData = {
      ...SAMPLE_DOCUMENT,
      sections: [
        ...SAMPLE_DOCUMENT.sections,
        {
          id: 'sec_extra',
          blocks: [
            {
              id: 'blk_extra',
              type: 'paragraph',
              content: [
                {
                  kind: 'token',
                  spec: {
                    id: 'customer_name',
                    source: 'customer_name',
                    format: { kind: 'text' }
                  }
                }
              ]
            }
          ]
        }
      ]
    };
    const specs = collectSpecs(doc);
    expect(specs.filter((s) => s.id === 'customer_name')).toHaveLength(1);
  });
});

describe('resolveTokens', () => {
  it('renders field-backed and computed tokens through the real grammar', () => {
    const fields = stubFields({ customer_name: 'Acme Corp', retainer: 1500 });
    const { rendered, errors } = resolveTokens(SAMPLE_DOCUMENT, fields);

    expect(rendered.get('customer_name')).toBe('Acme Corp');
    expect(rendered.get('retainer')).toBe('$1,500.00');
    expect(rendered.get('total')).toBe('$1,620.00');
    expect(errors.size).toBe(0);
  });

  it('puts a formula error in errors, not rendered', () => {
    const fields = stubFields({ customer_name: 'Acme Corp', retainer: 1500 });
    const broken: DocumentData = {
      ...SAMPLE_DOCUMENT,
      sections: SAMPLE_DOCUMENT.sections.map((section) =>
        section.id !== 'sec_pricing'
          ? section
          : {
              ...section,
              blocks: section.blocks.map((block) =>
                block.id !== 'blk_pricing_tbl'
                  ? block
                  : {
                      ...block,
                      rows: block.rows?.map((row) =>
                        row.map((cell) => ({
                          content: cell.content.map((inline) =>
                            inline.kind === 'token' && inline.spec.id === 'total'
                              ? {
                                  kind: 'token' as const,
                                  spec: { ...inline.spec, formula: 'total +' }
                                }
                              : inline
                          )
                        }))
                      )
                    }
              )
            }
      )
    };

    const { rendered, errors } = resolveTokens(broken, fields);
    expect(errors.has('total')).toBe(true);
    expect(rendered.has('total')).toBe(false);
  });

  it('falls back to data.values for a token with no source (in-memory input)', () => {
    const memoryDoc: DocumentData = {
      theme: SAMPLE_DOCUMENT.theme,
      values: { note: 'hand-typed' },
      sections: [
        {
          id: 'sec_note',
          blocks: [
            {
              id: 'blk_note',
              type: 'paragraph',
              content: [
                { kind: 'token', spec: { id: 'note', format: { kind: 'text' } } }
              ]
            }
          ]
        }
      ]
    };
    const { rendered } = resolveTokens(memoryDoc, null);
    expect(rendered.get('note')).toBe('hand-typed');
  });
});

describe('routeTokenEdit', () => {
  it('routes a field-backed edit through fields.write, parsing numeric text, and returns null', () => {
    const write = jest.fn();
    const fields: FieldAccess = { read: () => undefined, write };

    const mutation = routeTokenEdit(SAMPLE_DOCUMENT, fields, 'retainer', '$2,000');

    expect(mutation).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
    const [[[{ spec, value }]]] = write.mock.calls;
    expect(spec.id).toBe('retainer');
    expect(value).toBe(2000);
  });

  it('routes a text-format field-backed edit with the raw string, unparsed', () => {
    const write = jest.fn();
    const fields: FieldAccess = { read: () => undefined, write };

    routeTokenEdit(SAMPLE_DOCUMENT, fields, 'customer_name', 'Acme Corp');

    const [[[{ value }]]] = write.mock.calls;
    expect(value).toBe('Acme Corp');
  });

  it('returns null and writes nothing for a computed token', () => {
    const write = jest.fn();
    const fields: FieldAccess = { read: () => undefined, write };

    const mutation = routeTokenEdit(SAMPLE_DOCUMENT, fields, 'total', '$999.00');

    expect(mutation).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it('returns a mutation that sets data.values[key] for an in-memory input token', () => {
    const memoryDoc: DocumentData = {
      theme: SAMPLE_DOCUMENT.theme,
      sections: [
        {
          id: 'sec_note',
          blocks: [
            {
              id: 'blk_note',
              type: 'paragraph',
              content: [
                { kind: 'token', spec: { id: 'note', format: { kind: 'text' } } }
              ]
            }
          ]
        }
      ]
    };

    const mutation = routeTokenEdit(memoryDoc, null, 'note', 'hand-typed');

    expect(mutation).not.toBeNull();
    const next = mutation!(memoryDoc);
    expect(next.values?.note).toBe('hand-typed');
    expect(memoryDoc.values).toBeUndefined();
  });
});
