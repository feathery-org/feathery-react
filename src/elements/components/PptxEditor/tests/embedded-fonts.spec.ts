import { importDeck } from '../core/model/import';
import { ensureDeckFontsLoaded, cssFamilyList } from '../core/render/fonts';
import { fixtureBytes } from './harness';
import { releaseEmbeddedFonts } from '../core/render/embeddedFonts';

it('loads the deck’s compressed Inter face instead of substituting a web version', async () => {
  const faces: Array<{ family: string; source: ArrayBuffer }> = [];
  const add = jest.fn();
  const remove = jest.fn();
  const oldFonts = document.fonts;
  const oldFace = window.FontFace;
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { add, delete: remove, addEventListener: jest.fn() }
  });
  window.FontFace = class {
    constructor(public family: string, public source: ArrayBuffer) {
      faces.push(this);
    }
    status = 'loaded';
    load() {
      return Promise.resolve(this);
    }
  } as unknown as typeof FontFace;
  try {
    const deck = importDeck(fixtureBytes('template1-text-group.pptx'));
    await ensureDeckFontsLoaded(deck);
    expect(faces).toHaveLength(1);
    expect(new Uint8Array(faces[0].source).slice(0, 4)).toEqual(
      new Uint8Array([0, 1, 0, 0])
    );
    expect(add).toHaveBeenCalledTimes(1);
    expect(cssFamilyList('Inter', deck)).toContain(faces[0].family);
    const otherDeck = importDeck(fixtureBytes('template1-text-group.pptx'));
    await ensureDeckFontsLoaded(otherDeck);
    expect(faces[1].family).not.toBe(faces[0].family);
    releaseEmbeddedFonts(deck.pkg);
    expect(remove).toHaveBeenCalledWith(faces[0]);
    expect(cssFamilyList('Inter', otherDeck)).toContain(faces[1].family);
    releaseEmbeddedFonts(otherDeck.pkg);
  } finally {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: oldFonts
    });
    window.FontFace = oldFace;
  }
});
