const FORM_STYLES = `
  #QFVFormPage {
    display: flex;
    flex: 1;
    flex-direction: column;
    width: 100%;
    margin: 0 auto;
  }
  #wrapper {
    position: static;
    background: #f6f7fa;
    overflow: auto;
    width: 100% !important;
    height: 100%;
  }
  #scroller {
    width: auto;
    position: static;
    max-width: 1000px;
    margin: 0 auto;
    background: none !important;
  }

  #QFVPageList {
    position: relative;
    border: none !important;
  }

  /*
   * Each <li> is the responsive "card". Its aspect-ratio (set inline per page
   * from the page's pt dimensions) reserves the correct height as the column
   * width changes, since the scaled page below does not contribute layout size.
   */
  #QFVPageList li {
    position: relative;
    margin: 5% 15pt;
    border: none !important;
    box-shadow: 0px 1.05px 5.27px 0px #23254340;
    border-radius: 8px;
    overflow: hidden;
  }

  /*
   * The page itself stays at its natural pt size and is scaled to fill the card
   * with a single uniform transform. Because the page image and every overlay
   * live in this one rigid coordinate space, they scale together and cannot
   * drift relative to each other at any width. --quik-page-scale is set per
   * page by the injected ResizeObserver (see PAGE_SCALE_SCRIPT).
   */
  #QFVPageList li > div {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    transform: scale(var(--quik-page-scale, 1));
  }

  #QFVPageList li > div > div {
    background: none !important;
  }

  #QFVPageList li > div > div > img {
    width: 100% !important;
    display: block !important;
  }

  /*
   * Overlay inputs are sized in pt that already account for their padding and
   * border (the source renders them border-box via its external CSS/JS, which
   * does not run inside this restructured iframe). Force border-box so the pt
   * width/height is the rendered box — otherwise content-box adds padding +
   * border on top and the boxes render too large, most visibly in height.
   */
  #QFVPageList input,
  #QFVPageList textarea,
  #QFVPageList select,
  #QFVPageList label {
    box-sizing: border-box !important;
  }

  .input-label {
    border: none !important;
  }

  #QFVPageList .input-label > span {
    width: 100% !important;
    aspect-ratio: 1 / 1;
    height: auto !important;
    background-size: contain;
  }
`;

/**
 * Left inset (in pt) that every overlay's source 'left' carries relative to the
 * page-width basis. Subtracted from all elements so inputs align with the page
 * image the same way labels already did.
 */
const PAGE_LEFT_OFFSET_PT = 2;

/**
 * Per-page top inset (in pt) baked into the source coordinate system: each page
 * contributes a 2px (= 1.5pt at 96dpi) top border, so page N's origin is
 * `1.5 + N * (pageHeight + 1.5)`. Confirmed empirically — before this offset the
 * residual vertical drift was exactly 1.5pt × (pageIndex + 1).
 */
const PAGE_TOP_GAP_PT = 1.5;

/**
 * Parses a CSS style value (e.g., "123pt" or "calc(2*456pt)") and returns the numerical value in 'pt'.
 * This function handles simple 'pt' values and 'calc()' expressions by using a safe evaluation.
 * @param {string} styleValue The style string to parse.
 * @returns {number} The numerical value in 'pt'.
 */
function parsePtValue(styleValue: string): number {
  return styleValue ? parseFloat(styleValue.replace('pt', '')) : 0;
}

/**
 * Makes the Quik document responsive by localizing each overlay onto its page
 * (in native `pt`) and scaling each page as a single rigid unit to fill its
 * responsive container.
 *
 * The source HTML positions every overlay absolutely against one document-wide
 * container, so coordinates are cumulative across pages and page dimensions are
 * declared in `pt`. Rather than re-deriving per-axis percentages (which couples
 * alignment to containing-block and box-model behavior), this keeps the page's
 * exact coordinate space intact and applies a uniform CSS transform, so the
 * page image and its overlays can never drift relative to one another.
 *
 * @param doc The document object to manipulate.
 */
function repositionFormInputs(doc: Document): void {
  // Overlays are absolutely positioned against a single document-wide container
  // (#scroller in the source), so their `top` values are cumulative across all
  // pages. Each page contributes its height plus a 2px (1.5pt) top border, so
  // the running origin starts at one border and grows by height + border.
  let pageOffsetPt = PAGE_TOP_GAP_PT;
  const pages = doc.querySelectorAll(
    '#QFVPageList > li > div'
  ) as NodeListOf<HTMLDivElement>;

  pages.forEach((page) => {
    const pageWidthPt = parsePtValue(page.style.width);
    const pageHeightPt = parsePtValue(page.style.height);

    if (pageWidthPt === 0 || pageHeightPt === 0) {
      console.error(
        'Could not determine page dimensions from style attribute:',
        page
      );
      // Still advance the cumulative origin so later pages stay in sync.
      pageOffsetPt += pageHeightPt + PAGE_TOP_GAP_PT;
      return;
    }

    // Localize each overlay from the document-wide cumulative coordinate system
    // onto this page, keeping native pt units. The whole page is scaled as one
    // rigid unit (see below), so overlays cannot drift relative to the image.
    Array.from(page.children).forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      // The page image fills the page box; leave it at its natural size.
      if (element.tagName === 'IMG' || element.querySelector('img')) return;

      const localTopPt = parsePtValue(element.style.top) - pageOffsetPt;
      // The source 'left' carries a small (~2pt) inset relative to the page
      // image's left edge; remove it so overlays sit on the artwork.
      const localLeftPt =
        parsePtValue(element.style.left) - PAGE_LEFT_OFFSET_PT;
      element.style.top = `${localTopPt}pt`;
      element.style.left = `${localLeftPt}pt`;
      // width/height stay in their native pt units and scale with the page.

      if (element.tagName === 'LABEL') {
        element.className = `input-label ${element.className}`;
      }
    });

    // Pin the page to its natural pt size; the injected ResizeObserver scales it
    // (via --quik-page-scale) to fill the responsive <li> card. The <li> gets
    // the matching aspect-ratio so it reserves the correct layout height.
    page.style.width = `${pageWidthPt}pt`;
    page.style.height = `${pageHeightPt}pt`;
    page.dataset.quikPageWidthPt = `${pageWidthPt}`;

    const li = page.parentElement as HTMLElement | null;
    if (li) li.style.aspectRatio = `${pageWidthPt} / ${pageHeightPt}`;

    pageOffsetPt += pageHeightPt + PAGE_TOP_GAP_PT;
  });
}

export function generateFormElement(
  doc: Document
): HTMLFormElement | undefined {
  const form = doc.querySelector('#QFVFormPage');
  if (!form) {
    console.warn('Form element not found in the document.');
    return undefined;
  }
  repositionFormInputs(doc);
  injectFormStyles(doc);
  injectPageScaleScript(doc);
  return form as HTMLFormElement;
}

function injectFormStyles(doc: Document): void {
  const customFormStyle = doc.createElement('style');
  customFormStyle.innerHTML = FORM_STYLES;
  doc.head.appendChild(customFormStyle);
}

/** Points-to-pixels factor at 96dpi (CSS reference pixel: 96px === 72pt). */
const PT_TO_PX = 96 / 72;

/**
 * Sets each page's --quik-page-scale so its natural pt width fills the
 * responsive <li> card, and keeps it updated on resize. Runs inside the form
 * iframe. Kept dependency-free and ES5-safe since it executes verbatim there.
 */
const PAGE_SCALE_SCRIPT = `
(function () {
  var PT_TO_PX = ${PT_TO_PX};
  function applyScale() {
    var pages = document.querySelectorAll(
      '#QFVPageList > li > div[data-quik-page-width-pt]'
    );
    for (var i = 0; i < pages.length; i++) {
      var page = pages[i];
      var li = page.parentElement;
      if (!li) continue;
      var widthPt = parseFloat(page.getAttribute('data-quik-page-width-pt'));
      if (!widthPt) continue;
      var naturalPx = widthPt * PT_TO_PX;
      var scale = li.clientWidth / naturalPx;
      if (scale > 0 && isFinite(scale)) {
        page.style.setProperty('--quik-page-scale', String(scale));
      }
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyScale);
  } else {
    applyScale();
  }
  window.addEventListener('resize', applyScale);
  if (typeof ResizeObserver !== 'undefined') {
    var list = document.querySelector('#QFVPageList');
    if (list) new ResizeObserver(applyScale).observe(list);
  }
})();
`;

function injectPageScaleScript(doc: Document): void {
  const script = doc.createElement('script');
  script.textContent = PAGE_SCALE_SCRIPT;
  doc.body.appendChild(script);
}
