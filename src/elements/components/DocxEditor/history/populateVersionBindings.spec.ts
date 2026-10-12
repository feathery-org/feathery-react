import { populateVersionBindings } from './populateVersionBindings';

// The read-only version viewer has no binding engine, so it relies on this
// helper to populate a stored version's placeholders the way the live editor
// does on open: raw tokens become content controls carrying their value.

const docWith = (...inlines: unknown[]) => ({
  sections: [{ blocks: [{ paragraphFormat: {}, inlines }] }]
});

const firstBlock = (sfdt: any) => sfdt.sections[0].blocks[0];

describe('populateVersionBindings', () => {
  it('converts a raw field token into a content control with its value', () => {
    const doc = docWith({ text: '[[name=qty|type=integer|value=12]]' });

    const out: any = populateVersionBindings(doc as any);

    const cc = (firstBlock(out).inlines || []).find(
      (i: any) => i.contentControlProperties
    );
    expect(cc).toBeTruthy();
    // The value is populated as the control's visible text (the raw token now
    // lives only in the control's `tag`, which holds the binding definition).
    const text = (cc.inlines || []).map((i: any) => i.text ?? '').join('');
    expect(text).toBe('12');
    expect(cc.contentControlProperties.tag).toBe(
      '[[name=qty|type=integer|value=12]]'
    );
  });

  it('returns the document untouched when it has no tokens', () => {
    const doc = docWith({ text: 'Just plain text, no placeholders.' });

    // Same reference back: a populated (already content-controlled) version is
    // never re-run through applyRules, so its stored revisions are preserved.
    expect(populateVersionBindings(doc as any)).toBe(doc);
  });
});
