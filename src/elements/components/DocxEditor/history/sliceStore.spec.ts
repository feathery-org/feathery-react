import { createSliceStore, stripImages } from './sliceStore';
import { hash32 } from './sfdtDiff/index';

const bigImage = 'data:image/png;base64,' + 'A'.repeat(500);

describe('stripImages', () => {
  it('digests long image payloads with the diff engine’s scheme', () => {
    const sfdt = JSON.stringify({
      sections: [
        { blocks: [{ inlines: [{ imageString: bigImage }, { text: 'hi' }] }] }
      ]
    });

    const out = JSON.parse(stripImages(sfdt));
    const inline = out.sections[0].blocks[0].inlines[0];
    expect(inline.imageString).toBe(`sha:${hash32(bigImage)}`);
    // Text is untouched.
    expect(out.sections[0].blocks[0].inlines[1].text).toBe('hi');
  });

  it('leaves short image references alone', () => {
    const sfdt = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ imageString: 'icon.png' }] }] }]
    });
    const out = JSON.parse(stripImages(sfdt));
    expect(out.sections[0].blocks[0].inlines[0].imageString).toBe('icon.png');
  });
});

describe('createSliceStore', () => {
  const doc = (text: string) =>
    JSON.stringify({ sections: [{ blocks: [{ inlines: [{ text }] }] }] });

  it('stores slices in order and strips their images', () => {
    const store = createSliceStore();
    store.push(
      JSON.stringify({
        sections: [{ blocks: [{ inlines: [{ imageString: bigImage }] }] }]
      }),
      'you'
    );
    store.push(doc('b'), 'robin', '2026-09-02T00:00:00Z');

    const all = store.all();
    expect(all.map((s) => s.author)).toEqual(['you', 'robin']);
    expect(all[1].endedAt).toBe('2026-09-02T00:00:00Z');
    const first = JSON.parse(all[0].sfdt as string);
    expect(first.sections[0].blocks[0].inlines[0].imageString).toBe(
      `sha:${hash32(bigImage)}`
    );
  });

  it('coalesces the oldest same-author pair when over the cap', () => {
    const store = createSliceStore(3);
    store.push(doc('a1'), 'you'); // [you, you] pair is oldest
    store.push(doc('a2'), 'you');
    store.push(doc('r1'), 'robin');
    store.push(doc('r2'), 'robin'); // 4 > 3 → drop the earlier 'you'

    const authors = store.all().map((s) => s.author);
    expect(store.size()).toBe(3);
    expect(store.isComplete()).toBe(true);
    // The earlier of the oldest same-author pair (a1) is gone; a2 remains.
    expect(authors).toEqual(['you', 'robin', 'robin']);
    expect(JSON.parse(store.all()[0].sfdt as string)).toEqual(
      JSON.parse(doc('a2'))
    );
  });

  it('drops the oldest slice when no adjacent same-author pair exists', () => {
    const store = createSliceStore(2);
    store.push(doc('a'), 'you');
    store.push(doc('b'), 'robin');
    store.push(doc('c'), 'you'); // 3 > 2, no adjacent same-author → drop oldest

    expect(store.size()).toBe(2);
    expect(store.isComplete()).toBe(false);
    expect(store.all().map((s) => s.author)).toEqual(['robin', 'you']);
  });

  it('clears all slices', () => {
    const store = createSliceStore();
    store.push(doc('a'), 'you');
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.all()).toEqual([]);
    expect(store.isComplete()).toBe(true);
  });
});
