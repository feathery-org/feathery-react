import { generateFormElement } from '../form';

/**
 * Builds a minimal Quik document with one page per overlay, each 612x792pt,
 * where every page carries one background image and one absolutely-positioned
 * overlay input. Overlay `top` values are cumulative across the document (as in
 * the real Quik HTML); `left` is per-page.
 */
function buildDoc(
  overlays: { id: string; left: number; top: number }[]
): Document {
  const PAGE_W = 612;
  const PAGE_H = 792;
  const pages = overlays
    .map(
      ({ id, left, top }) => `
        <li>
          <div style="width:${PAGE_W}pt;height:${PAGE_H}pt;">
            <div><img src="page.png" /></div>
            <input
              id="${id}"
              style="position:absolute;left:${left}pt;top:${top}pt;width:168pt;height:14pt"
            />
          </div>
        </li>`
    )
    .join('');

  const html = `<!DOCTYPE html><html><head></head><body>
    <div id="QFVFormPage"><ul id="QFVPageList">${pages}</ul></div>
  </body></html>`;

  return new DOMParser().parseFromString(html, 'text/html');
}

function topPt(doc: Document, id: string): number {
  return parseFloat((doc.getElementById(id) as HTMLElement).style.top);
}
function leftPt(doc: Document, id: string): number {
  return parseFloat((doc.getElementById(id) as HTMLElement).style.left);
}

describe('generateFormElement / repositionFormInputs', () => {
  it('localizes the first page overlay by the leading 1.5pt border and 2pt left inset', () => {
    // Page 0 origin = 1.5pt (one top border). Left inset = 2pt.
    const doc = buildDoc([{ id: 'a', left: 46.3, top: 245.17 }]);

    generateFormElement(doc);

    expect(topPt(doc, 'a')).toBeCloseTo(245.17 - 1.5, 3);
    expect(leftPt(doc, 'a')).toBeCloseTo(46.3 - 2, 3);
  });

  it('advances the cumulative origin by pageHeight + 1.5pt for each later page', () => {
    // Page 1 origin = 1.5 + (792 + 1.5) = 795pt.
    const doc = buildDoc([
      { id: 'a', left: 46.3, top: 245.17 },
      { id: 'b', left: 50, top: 852.09 }
    ]);

    generateFormElement(doc);

    expect(topPt(doc, 'b')).toBeCloseTo(852.09 - 795, 3);
    expect(leftPt(doc, 'b')).toBeCloseTo(50 - 2, 3);
  });

  it('pins each page to its natural pt size and exposes the scale metadata', () => {
    const doc = buildDoc([{ id: 'a', left: 46.3, top: 245.17 }]);

    generateFormElement(doc);

    const page = doc.querySelector('#QFVPageList > li > div') as HTMLDivElement;
    expect(page.style.width).toBe('612pt');
    expect(page.style.height).toBe('792pt');
    expect(page.dataset.quikPageWidthPt).toBe('612');

    const li = page.parentElement as HTMLElement;
    expect(li.style.aspectRatio.replace(/\s/g, '')).toBe('612/792');
  });

  it('does not reposition the page background image wrapper', () => {
    const doc = buildDoc([{ id: 'a', left: 46.3, top: 245.17 }]);

    generateFormElement(doc);

    const imageWrapper = doc.querySelector(
      '#QFVPageList > li > div > div'
    ) as HTMLElement;
    // The wrapper holds the <img>; the transform must leave it untouched.
    expect(imageWrapper.style.top).toBe('');
    expect(imageWrapper.style.left).toBe('');
  });

  it('injects the page-scale script into the document', () => {
    const doc = buildDoc([{ id: 'a', left: 46.3, top: 245.17 }]);

    generateFormElement(doc);

    const scripts = Array.from(doc.querySelectorAll('script'));
    expect(
      scripts.some((s) => s.textContent?.includes('--quik-page-scale'))
    ).toBe(true);
  });
});
