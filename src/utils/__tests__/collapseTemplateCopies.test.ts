import { collapseTemplateCopies } from '../templateCopies';

describe('collapseTemplateCopies', () => {
  it('folds each template copy into one entry at its first position', () => {
    const alice = { owner_name: 'Alice', optional_election: '' };
    const docs = [
      { documentId: 'A', values: alice },
      'other-template',
      { documentId: 'a', values: { owner_name: 'Bob', tags: ['x'] } },
      { kind: 'quik' as const }
    ];

    const result = collapseTemplateCopies(docs);
    alice.owner_name = 'changed after the call';

    expect(result).toEqual([
      {
        kind: 'template',
        document_id: 'A',
        values: [
          { owner_name: 'Alice', optional_election: '' },
          { owner_name: 'Bob', tags: ['x'] }
        ]
      },
      'other-template',
      { kind: 'quik' }
    ]);
  });

  it('keeps one reference per copy and rejects a partial set', () => {
    expect(
      collapseTemplateCopies([
        { documentId: 'A', values: {}, reference: 'first' },
        { documentId: 'A', values: {}, reference: 'second' }
      ])
    ).toEqual([
      {
        kind: 'template',
        document_id: 'A',
        values: [{}, {}],
        references: ['first', 'second']
      }
    ]);
    expect(() =>
      collapseTemplateCopies([
        { documentId: 'A', values: {}, reference: 'first' },
        { documentId: 'A', values: {} }
      ])
    ).toThrow('reference');
  });
});
