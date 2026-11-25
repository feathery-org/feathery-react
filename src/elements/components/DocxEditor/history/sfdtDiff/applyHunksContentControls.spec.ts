// A version's highlights must not strip content controls (bound [[...]] fields):
// editing a paragraph that contains one has to keep the control wrapper in the
// display document, or the field stops rendering in the viewer.
import {
  docWith,
  para,
  taggedInline
} from '../../bindings/tests/realEditorHarness';
import { applyHunks, diffSession } from './index';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const ccOf = (block: any) =>
  (block.inlines ?? []).find((i: any) => i.contentControlProperties);

describe('applyHunks content controls', () => {
  it('keeps the control wrapper when its text is edited', () => {
    const base = docWith(para(taggedInline('[[co]]', 'Acme Inc')));
    const after = docWith(para(taggedInline('[[co]]', 'Acme LLC')));

    const changes = diffSession(
      base,
      [{ sfdt: clone(after), author: 'user' }],
      's'
    );
    const display = applyHunks(clone(after), changes);

    const cc = ccOf(display.sections[0].blocks[0]);
    expect(cc).toBeTruthy();
    expect(cc.contentControlProperties.tag).toBe('[[co]]');
    // The surviving text stays inside the control...
    const innerText = (cc.inlines ?? []).map((i: any) => i.text ?? '').join('');
    expect(innerText).toContain('LLC');
    // ...and the inserted range is marked as a revision inside the control.
    expect(
      (cc.inlines ?? []).some(
        (i: any) => Array.isArray(i.revisionIds) && i.revisionIds.length
      )
    ).toBe(true);
  });

  it('leaves a content control untouched when its paragraph is unedited', () => {
    // An edit in a DIFFERENT paragraph must not disturb this control's block.
    const base = docWith(
      para(taggedInline('[[co]]', 'Acme Inc')),
      para({ text: 'Second line.' })
    );
    const after = docWith(
      para(taggedInline('[[co]]', 'Acme Inc')),
      para({ text: 'Second line edited.' })
    );

    const changes = diffSession(
      base,
      [{ sfdt: clone(after), author: 'user' }],
      's'
    );
    const display = applyHunks(clone(after), changes);

    const cc = ccOf(display.sections[0].blocks[0]);
    expect(cc).toBeTruthy();
    expect(cc.inlines[0].text).toBe('Acme Inc');
  });
});
