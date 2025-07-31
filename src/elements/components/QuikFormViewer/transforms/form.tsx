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
    max-width: 620px;
    margin: 0 auto;
  }

  #QFVPageList {
    position: relative;
  }
`;

export function generateFormElement(
  doc: Document
): HTMLFormElement | undefined {
  const form = doc.querySelector('#QFVFormPage');
  if (!form) {
    console.warn('Form element not found in the document.');
    return undefined;
  }
  injectFormStyles(doc);
  return form as HTMLFormElement;
}

function injectFormStyles(doc: Document): void {
  const customFormStyle = doc.createElement('style');
  customFormStyle.innerHTML = FORM_STYLES;
  doc.head.appendChild(customFormStyle);
}
