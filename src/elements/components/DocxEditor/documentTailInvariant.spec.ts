import {
  ensureTrailingBodyParagraph,
  installDocumentTailInvariant
} from './documentTailInvariant';

describe('the document-tail paragraph invariant', () => {
  it.each([
    [
      'verbose',
      { sections: [{ blocks: [{ rows: [] }] }] },
      'sections',
      'blocks',
      'inlines'
    ],
    [
      'optimized',
      { optimizeSfdt: true, sec: [{ b: [{ r: [] }] }] },
      'sec',
      'b',
      'i'
    ]
  ])(
    'adds one idempotent trailing paragraph to %s SFDT',
    (_label, sfdt, sectionsKey, blocksKey, inlinesKey) => {
      const once = ensureTrailingBodyParagraph(JSON.stringify(sfdt)) as string;
      const twice = ensureTrailingBodyParagraph(once) as string;
      const document = JSON.parse(twice);
      const blocks = document[sectionsKey][0][blocksKey];

      expect(blocks).toHaveLength(2);
      expect(blocks[1]).toEqual({ [inlinesKey]: [] });
    }
  );

  it('normalizes compressed service output through the installed load seam', () => {
    const processSfdt = jest.fn();
    const editor: any = { processSfdt };
    const document = { sections: [{ blocks: [{ rows: [] }] }] };
    const decode = jest.fn(() => document);

    installDocumentTailInvariant(editor, decode);
    editor.processSfdt('{"sfdt":"compressed"}', true);

    expect(decode).toHaveBeenCalledWith('{"sfdt":"compressed"}');
    expect(processSfdt).toHaveBeenCalledWith(
      JSON.stringify({
        sections: [{ blocks: [{ rows: [] }, { inlines: [] }] }]
      }),
      true
    );
  });
});
