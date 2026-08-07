/**
 * Overlay logic in isolation.
 *
 * jsdom cannot lay out a real Syncfusion document, so there is no pixel geometry
 * to assert against — these cover only the isolable logic: kind→colour mapping,
 * which controls count, and the attach/detach lifecycle against a fake editor
 * whose `documentHelper.pageContainer` is a real jsdom element. Pixel alignment,
 * zoom scaling, and multi-page offsets are verified in the browser.
 */

import { encodeTag } from '../controls';
import { TokenSpec } from '../plan';
import {
  attachTokenOverlay,
  controlRects,
  DERIVED_OVERLAY,
  documentRects,
  INPUT_OVERLAY,
  overlayColor,
  pageOffset,
  tokenControls
} from '../tokenOverlay';

/** A fake content control carrying a token tag, mirroring the real shape. */
const control = (spec: TokenSpec) => ({
  contentControlProperties: { tag: encodeTag(spec) }
});

/** A control whose tag is not ours (a native Word content control). */
const foreignControl = (tag: string) => ({
  contentControlProperties: { tag }
});

/**
 * A minimal `documentEditor` stand-in — a real jsdom pageContainer plus the
 * collection, zoom, and listener surface the overlay touches. Mirrors the
 * fake-editor style in tokenCycle.spec.ts.
 */
const fakeEditor = (controls: any[]) => {
  const pageContainer = document.createElement('div');
  document.body.appendChild(pageContainer);
  const handlers: Record<string, Array<() => void>> = {};

  return {
    zoomFactor: 1,
    documentHelper: {
      pageContainer,
      contentControlCollection: controls,
      pages: []
    },
    addEventListener: (event: string, handler: () => void) => {
      handlers[event] = [...(handlers[event] ?? []), handler];
    },
    removeEventListener: (event: string, handler: () => void) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler);
    },
    pageContainer,
    listenerCount: (event: string) => (handlers[event] ?? []).length
  };
};

const inputSpec: TokenSpec = {
  id: 'client',
  source: 'client',
  format: { kind: 'text' }
};
const derivedSpec: TokenSpec = {
  id: 'total',
  formula: 'subtotal * 2',
  format: { kind: 'currency' }
};

describe('overlayColor — kind maps to colour', () => {
  it('gives an input (field-backed) token the input colour', () => {
    expect(overlayColor(inputSpec)).toBe(INPUT_OVERLAY);
  });

  it('gives a memory token (no source, no formula) the input colour', () => {
    expect(overlayColor({ id: 'note', format: { kind: 'text' } })).toBe(
      INPUT_OVERLAY
    );
  });

  it('gives a derived (formula) token the derived colour', () => {
    expect(overlayColor(derivedSpec)).toBe(DERIVED_OVERLAY);
  });

  it('treats a blank formula as an input, not derived', () => {
    expect(overlayColor({ id: 'x', formula: '   ' })).toBe(INPUT_OVERLAY);
  });
});

describe('tokenControls — decode and skip', () => {
  it('returns one entry per decodable control with its colour', () => {
    const editor = fakeEditor([control(inputSpec), control(derivedSpec)]);
    const found = tokenControls(editor);

    expect(found.map((f) => f.color)).toEqual([INPUT_OVERLAY, DERIVED_OVERLAY]);
  });

  it('skips foreign and undecodable controls', () => {
    const editor = fakeEditor([
      control(inputSpec),
      foreignControl('some-native-word-tag'),
      foreignControl('ftk:{not valid json'),
      { contentControlProperties: {} }
    ]);

    expect(tokenControls(editor)).toHaveLength(1);
  });

  it('returns nothing when there is no content-control collection', () => {
    expect(tokenControls({ documentHelper: {} })).toEqual([]);
    expect(tokenControls(undefined)).toEqual([]);
  });
});

describe('attachTokenOverlay — lifecycle', () => {
  it('appends a single overlay layer into the page container', () => {
    const editor = fakeEditor([control(inputSpec)]);

    attachTokenOverlay(editor);

    const layers = editor.pageContainer.querySelectorAll(
      '.feathery-token-overlay'
    );
    expect(layers).toHaveLength(1);
  });

  it('registers reposition listeners on the editor', () => {
    const editor = fakeEditor([]);
    attachTokenOverlay(editor);

    expect(editor.listenerCount('zoomFactorChange')).toBe(1);
    expect(editor.listenerCount('contentChange')).toBe(1);
  });

  it('detach removes the layer and every editor listener', () => {
    const editor = fakeEditor([control(inputSpec)]);
    const detach = attachTokenOverlay(editor);

    detach();

    expect(
      editor.pageContainer.querySelectorAll('.feathery-token-overlay')
    ).toHaveLength(0);
    expect(editor.listenerCount('zoomFactorChange')).toBe(0);
    expect(editor.listenerCount('contentChange')).toBe(0);
  });

  it('does not throw, and paints no overlay, without a page container', () => {
    const bare: any = { documentHelper: {} };

    let detach: () => void = () => undefined;
    expect(() => {
      detach = attachTokenOverlay(bare);
    }).not.toThrow();
    expect(() => detach()).not.toThrow();
  });

  it('renders no cells in jsdom, where there is no real layout, and stays quiet', () => {
    // Controls with no resolvable widget geometry must be skipped, not thrown on.
    const editor = fakeEditor([control(inputSpec), control(derivedSpec)]);
    attachTokenOverlay(editor);

    const layer = editor.pageContainer.querySelector('.feathery-token-overlay');
    expect(layer?.children).toHaveLength(0);
  });
});

// ── The zoom transform ───────────────────────────────────────────────────────
// The overlay's whole correctness hinges on ONE formula (from the module doc):
//   top = (rect.y - pageGap*(idx+1))*zoom + pageGap*(idx+1)
// i.e. the inter-page gap is added back UN-scaled. The old naive `rect.y*zoom`
// drifted by pageGap*(idx+1)*(zoom-1). These lock that math against plain mocks;
// jsdom can't lay out Syncfusion, so we assert on mocked layout inputs, not pixels.

const PAGE_GAP = 20;

/** A line whose page carries a known bounding rect and index. */
const lineOnPage = (idx: number, rect: { x: number; y: number }) => ({
  paragraph: { page: { index: idx, boundingRectangle: rect } }
});

const editorWithGap = (pages: any[] = []) => ({
  viewer: { pageGap: PAGE_GAP },
  documentHelper: { pages }
});

describe('pageOffset — page gap is added back un-scaled', () => {
  it('is identity at zoom=1 on page 0 (top === rect.y, left === rect.x)', () => {
    const line = lineOnPage(0, { x: 5, y: 100 });
    expect(pageOffset(editorWithGap(), line, 1)).toEqual({ left: 5, top: 100 });
  });

  it('scales content but not the gap at zoom=2 on page 0', () => {
    const line = lineOnPage(0, { x: 5, y: 100 });
    // (100 - 20*1)*2 + 20*1 = 180, NOT the naive 100*2 = 200.
    const offset = pageOffset(editorWithGap(), line, 2);
    expect(offset).toEqual({ left: 5, top: 180 });
    expect(offset?.top).not.toBe(100 * 2);
  });

  it('does not scale the gap term at zoom=2 on page index > 0', () => {
    const line = lineOnPage(1, { x: 5, y: 500 });
    // (500 - 20*2)*2 + 20*2 = 960, NOT the naive 500*2 = 1000.
    const offset = pageOffset(editorWithGap(), line, 2);
    expect(offset).toEqual({ left: 5, top: 960 });
    expect(offset?.top).not.toBe(500 * 2);
  });

  it('returns null when the page has no usable bounding rectangle', () => {
    expect(pageOffset(editorWithGap(), { paragraph: {} }, 1)).toBeNull();
  });
});

describe('controlRects — scales the token rect by zoom and adds the page offset', () => {
  it('multiplies left/top/width/height by zoom and offsets by the page origin', () => {
    const page = { index: 0, boundingRectangle: { x: 5, y: 50 } };
    // A single line holding [start control, one content box, end marker].
    const contentBox = { length: 5 };
    const endBox = { contentControlProperties: {}, type: 1 };
    const startLine: any = {
      paragraph: { page },
      height: 15
    };
    const startControl: any = { line: startLine };
    startLine.children = [startControl, contentBox, endBox];

    const sel = {
      // offset 0 → left edge (10); the right edge is addressed at the box length.
      getLeftInternal: (_line: any, _box: any, offset: number) =>
        offset === 0 ? 10 : 30,
      getTop: () => 100
    };
    const editor = { selection: sel, ...editorWithGap([page]) };

    // Unzoomed doc rect: left 10, top 100, width 20, height 15.
    expect(documentRects(sel, startControl)).toEqual([
      { line: startLine, rect: { left: 10, top: 100, width: 20, height: 15 } }
    ]);

    // pageOffset at zoom 2, page 0: left 5, top (50-20)*2+20 = 80.
    // controlRects: left 5+10*2=25, top 80+100*2=280, width 20*2=40, height 15*2=30.
    expect(controlRects(editor, startControl, 2)).toEqual([
      { left: 25, top: 280, width: 40, height: 30 }
    ]);
  });
});
