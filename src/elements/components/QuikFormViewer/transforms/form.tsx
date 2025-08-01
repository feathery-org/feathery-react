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

  #QFVPageList li {
    position: relative;
    margin: 5% 15pt;
    border: none !important;
    box-shadow: 0px 1.05px 5.27px 0px #23254340;
    border-radius: 8px;
    overflow: hidden;
  }

  #QFVPageList li > div {
    width: 100% !important;
    height: auto !important;
    position: relative;
    overflow: hidden;
  }

  #QFVPageList li > div > div {
    background: none !important;
  }

  #QFVPageList li > div > div > img {
    width: 100% !important;
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
 * Parses a CSS style value (e.g., "123pt" or "calc(2*456pt)") and returns the numerical value in 'pt'.
 * This function handles simple 'pt' values and 'calc()' expressions by using a safe evaluation.
 * @param {string} styleValue The style string to parse.
 * @returns {number} The numerical value in 'pt'.
 */
function parsePtValue(styleValue: string): number {
  if (!styleValue) return 0;
  if (styleValue.includes('calc')) {
    const expression = styleValue.replace(/calc\((.*)\)/, '$1').trim();
    try {
      // Safety check before using eval
      const safeExpression = expression
        .replace(/pt/g, '')
        .replace(/[^\d\+\-\*\/\.]/g, '');
      return eval(safeExpression);
    } catch (e) {
      console.error('Failed to parse calc() expression:', expression, e);
      return 0;
    }
  } else {
    return parseFloat(styleValue.replace('pt', ''));
  }
}

/**
 * Recalculates the 'top', 'left', 'width', and 'height' of all elements to be
 * relative to their page container and converts them to percentage values.
 *
 * This function is designed to work with the provided HTML structure where
 * elements have absolute positioning based on the entire document and page
 * containers have their dimensions defined in `pt` in their style attribute.
 * It makes the layout responsive by converting these fixed `pt` values to
 * percentages based on the parent page's dimensions.
 *
 * @param doc The document object to manipulate.
 */
function repositionFormInputs(doc: Document): void {
  let pageOffsetPt = 1.5; // original positions include 2px (1.5pt) top border per page
  const pages = doc.querySelectorAll(
    '#QFVPageList > li > div'
  ) as NodeListOf<HTMLDivElement>;

  pages.forEach((page) => {
    // Dynamically get the page's dimensions from its style attribute.
    const pageWidthPt = parsePtValue(page.style.width);
    const pageHeightPt = parsePtValue(page.style.height);

    if (pageWidthPt === 0 || pageHeightPt === 0) {
      console.error(
        'Could not determine page dimensions from style attribute:',
        page
      );
      return; // Skip this page if dimensions are not found.
    }

    // Get all child elements of the page, not just inputs.
    const elements = Array.from(page.children);
    elements.forEach((element) => {
      if (element instanceof HTMLElement) {
        const style = element.style;

        // Get original pt values for all relevant properties.
        let currentTopPt = parsePtValue(style.top);
        let currentLeftPt = parsePtValue(style.left);
        const currentWidthPt = parsePtValue(style.width);
        const currentHeightPt = parsePtValue(style.height);

        // Recalculate relative top position in pt by subtracting the cumulative page offset.
        let relativeTopPt = currentTopPt - pageOffsetPt;

        if (element.tagName === 'LABEL') {
          currentLeftPt -= 2; // Adjust for label (radio box)'s left offset
        }

        // Convert pt values to percentages.
        const newTopPercent = (relativeTopPt / pageHeightPt) * 100;
        const newLeftPercent = (currentLeftPt / pageWidthPt) * 100;
        const newWidthPercent = (currentWidthPt / pageWidthPt) * 100;
        const newHeightPercent = (currentHeightPt / pageHeightPt) * 100;

        // Update the element's style with percentage values.
        style.top = `${newTopPercent.toFixed(2)}%`;
        style.left = `${newLeftPercent.toFixed(2)}%`;
        style.width = `${newWidthPercent.toFixed(2)}%`;
        style.height = `${newHeightPercent.toFixed(2)}%`;

        if (element.tagName === 'LABEL') {
          element.className = `input-label ${element.className}`;
        }
      }
    });

    // Update the cumulative page offset for the next page.
    pageOffsetPt += pageHeightPt + 1.5; // Add 1.5pt for the top border of the next page
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
  return form as HTMLFormElement;
}

function injectFormStyles(doc: Document): void {
  const customFormStyle = doc.createElement('style');
  customFormStyle.innerHTML = FORM_STYLES;
  doc.head.appendChild(customFormStyle);
}
