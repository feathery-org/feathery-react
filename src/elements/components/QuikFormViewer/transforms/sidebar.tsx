import { featheryDoc, featheryWindow } from '../../../../utils/browser';

const SIDEBAR_WIDTH = '200px';

const SIDEBAR_STYLES = `
  #navWrapper {
    width: ${SIDEBAR_WIDTH};
    flex-shrink: 0;
    height: auto;
    position: static;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    padding: 0;
    padding-top: 16px;
    overflow-y: auto;
    box-shadow: 0px 0px 4px 0px #727B9975;
  }

  /* Consistent header styling for all sections */
  .section-header {
    height: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    margin-bottom: 8px;
    padding: 0 16px;
  }

  .section-header span {
    font-weight: 600;
    font-size: 14px;
    line-height: 20px;
    letter-spacing: 0%;
    vertical-align: middle;
    color: #333849;
  }

  .pages-nav {
    display: flex;
    gap: 8px;
    font-size: 12px;
  }

  .pages-nav span {
    cursor: pointer;
    color: #6C7589;
    text-decoration: underline;
    transition: color 0.2s ease;
  }

  .pages-nav span:hover {
    color: #333849;
  }

  #navPage {
    background: #F4F5F8;
    border: 1px solid #EBEDF2;
    border-radius: 12px;
    margin: 0 16px;
    width: auto;
    height: auto;
    flex-shrink: 1;
    max-height: 500px;
    overflow-y: auto;
    min-height: 350px;
  }

  #navPage ul {
    width: 100%;
    padding: 0;
    margin: 0;
  }

  #navPage li {
    margin: 10px auto;
    border-radius: 10px;
    box-shadow: 0px 2.5px 12px 0px #23254340;
    width: fit-content;
    cursor: pointer;
  }

  #navPage li:hover {
    box-shadow: none;
    outline: 3px solid #E2626E;
  }

  #navPage li div {
    width: auto;
    height: auto !important;
    border-radius: 10px;
    border: none !important;
    overflow: hidden;
    position: relative;
  }

  #navPage li div span {
    right: 4px !important;
    left: unset !important;
    top: unset !important;
    bottom: 4px !important;
    transform: unset !important;
    height: 20px !important;
    width: 20px !important;
    color: white !important;
    background: black !important;
    border-radius: 5px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 15px !important;
  }

  #navPage li div br {
    display: none !important;
  }

  #navPage, #navFormHeader, #navForm, #navAttachmentsHeader, #navAttachments {
    position: static;
  }

  #navWrapper > #navAttachmentsHeader {
    width: unset;
    height: auto;
    overflow: unset !important;
    flex: 1;
  }

  /* The footer element with only text content */
  .sidebar-footer {
    padding: 10px;
    background: #fbeaea;
    color: #cb4e5a;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 12px;
    font-weight: 500;
    line-height: 20px;
    position: sticky;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 999;
  }

  #navFormHeader, #navForm {
    padding: 0px 16px;
  }

  #navForm {
    margin-bottom: 16px;
  }

  .attachments-plus-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 8px;
    font-size: 20px;
    color: #6c7589;
    line-height: 1;
    transition: color 0.2s ease;
  }

  .attachments-plus-btn:hover {
    color: #333849;
  }

  #navAttachments, #navForm {
    background-color: transparent;
    width: auto;
    height: auto;
    border: none !important;
    flex-shrink: 0;
    overflow: visible;
  }

  #navAttachments ul, #navForm ul {
    list-style: none;
    padding: 0;
    margin: 0;
    border-style: solid;
    border-width: 1px;
    border-color: #DBDFE8;
    border-radius: 8px;
    background: #fff;
    width: auto;
    height: auto;
  }

  #navAttachments ul:empty, #navForm ul:empty {
    border: none !important;
  }

  #navAttachments li, #navForm li {
    display: flex;
    background: transparent;
    align-items: center;
    padding-inline: 12px;
    border-bottom: 1px solid #dbdfe8;
    position: relative;
    min-height: 44px;
    cursor: pointer;
  }

  #navAttachments li:last-child, #navForm li:last-child {
    border-bottom: none;
  }

  #navForm li .form-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    padding-block: 12px;
  }

  #navForm li .form-content a {
    font-weight: 600;
    font-size: 12px;
    color: #333849;
    text-decoration: none;
  }

  #navForm li .form-content em {
    font-weight: 400;
    font-size: 10px;
    font-style: normal;
    color: #6C7589;
    margin-top: 4px;
  }

  #navForm li .form-content br {
    display: none;
  }

  #navForm li {
    transition: background-color 0.2s ease;
  }

  #navForm li:hover {
    background-color: #f3f4f6;
  }

  /* Style the filename span */
  #navAttachments li > span {
    font-style: normal;
    font-weight: 600;
    font-size: 11px;
    line-height: 14px;
    color: #333849;
    flex: 1;
  }

  /* Hide original delete image and show trash icon */
  #navAttachments li > img[src*="remove.png"] {
    width: 0 !important;
    height: 0 !important;
    padding: 10px !important;
    background-image: url("data:image/svg+xml,%3Csvg width='21' height='20' viewBox='0 0 21 20' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2.50781 5H4.09106H18.7927' stroke='%23656A7D' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M7.74219 4.2V3.6C7.74219 3.17565 7.89538 2.76869 8.16806 2.46863C8.44074 2.16857 8.81057 2 9.19619 2H12.1042C12.4898 2 12.8597 2.16857 13.1323 2.46863C13.405 2.76869 13.5582 3.17565 13.5582 3.6V4.2' stroke='%23656A7D' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M4.54297 5L5.45494 16.1628C5.53973 17.2008 6.40687 18 7.4483 18H13.8513C14.8927 18 15.7599 17.2008 15.8446 16.1629L16.7566 5' stroke='%23656A7D' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M8.61523 8V14.5' stroke='%23656A7D' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M12.6855 8V14.5' stroke='%23656A7D' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-size: 20px 20px;
    background-repeat: no-repeat;
    background-position: center;
    overflow: hidden;
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.2s ease;
    order: 2;
  }

  #navAttachments {
    padding: 0 16px;
    margin-bottom: 16px;
  }
  #navAttachments li > img[src*="remove.png"]:hover {
    opacity: 1;
  }

  #navAttachments ul:empty::after {
    content: 'No attachments';
    display: block;
    text-align: center;
    color: #9ca3af;
    font-size: 11px;
    padding: 12px;}
`;

/**
 * Helper function to extract full-size image URL from corresponding page div
 * @param {Document} doc The document object.
 * @param {string} thumbnailUrl The URL of the thumbnail image.
 * @returns {string|null} The URL of the full-size image or null if not found.
 */
function getFullSizeImageUrl(doc: any, thumbnailUrl: string) {
  try {
    const urlMatch = thumbnailUrl.match(/t?(\d+)_(\d+)_\d+\.png/);
    if (!urlMatch) return null;

    const formId = urlMatch[1];
    const pageNum = urlMatch[2];

    // Look for the corresponding full-size div
    const fullSizeDiv = doc.getElementById(`ID${formId}p${pageNum}`);
    if (fullSizeDiv) {
      const img = fullSizeDiv.querySelector('img');
      if (img && img.src) {
        return img.src;
      }
    }
    return null;
  } catch (e) {
    console.warn('Error extracting full-size image URL:', e);
    return null;
  }
}

/**
 * Transforms list item backgrounds into img elements for better display.
 * @param {HTMLUListElement} ulElement The UL element to transform.
 * @param {Document} doc The document object.
 * @param {object} options Optional configuration for the transformation.
 * @returns {number} The number of transformed elements.
 */
function transformULBackgroundToImg(
  ulElement: any,
  doc: any,
  options: Record<string, any> = {}
) {
  const {
    imageWidth = '140px',
    preserveAspectRatio = true,
    centerImage = true,
    removeBackgroundImage = true
  } = options;

  if (!ulElement || ulElement.tagName !== 'UL') {
    console.error('Input must be a UL element');
    return 0;
  }

  const listItems = ulElement.querySelectorAll('li');
  let transformedCount = 0;

  listItems.forEach((li: any) => {
    const divsWithBg = li.querySelectorAll('div[style*="background-image"]');

    divsWithBg.forEach((div: any) => {
      const style = div.style;
      const computedStyle = featheryWindow().getComputedStyle(div);

      const backgroundImage =
        style.backgroundImage || computedStyle.backgroundImage;
      if (!backgroundImage || backgroundImage === 'none') return;

      const urlMatch = backgroundImage.match(/url\(['"]?([^'"]*?)['"]?\)/);
      if (!urlMatch) return;

      let imageUrl = urlMatch[1];
      try {
        imageUrl = decodeURIComponent(imageUrl);
      } catch (e) {}
      imageUrl = imageUrl.replace(/&amp;/g, '&');

      const fullSizeUrl = getFullSizeImageUrl(doc, imageUrl);
      if (fullSizeUrl) {
        imageUrl = fullSizeUrl;
      }

      const altText = div.getAttribute('title') || 'Form Image';

      const img = featheryDoc().createElement('img');
      img.src = imageUrl;
      img.alt = altText;

      let imgStyles = `width: ${imageWidth};`;
      if (preserveAspectRatio) {
        imgStyles += ' height: auto; object-fit: contain; max-height: 100%;';
      }
      img.style.cssText = imgStyles;

      if (removeBackgroundImage) {
        div.style.backgroundImage = 'none';
        div.style.backgroundRepeat = 'none';
      }

      if (centerImage) {
        const position = computedStyle.position;
        if (position === 'static') {
          div.style.position = 'relative';
        }

        const display = computedStyle.display;
        if (display !== 'flex') {
          div.style.display = 'flex';
          div.style.alignItems = 'center';
          div.style.justifyContent = 'center';
        }

        const existingContent = Array.from(div.children);
        existingContent.forEach((child: any) => {
          if (child.tagName === 'SPAN') {
            child.style.position = 'absolute';
            if (
              !child.style.top &&
              !child.style.bottom &&
              !child.style.transform.includes('translateY')
            ) {
              child.style.top = '50%';
              child.style.transform =
                (child.style.transform || '') + ' translateY(-50%)';
            }
            if (!child.style.left && !child.style.right) {
              child.style.left = '10px';
            }
          }
        });
      }
      div.insertBefore(img, div.firstChild);
      transformedCount++;
    });
  });
  return transformedCount;
}

/**
 * Transforms the forms list items to wrap their content in a new div for proper styling,
 * preserving the original onclick functionality.
 * @param {Document} doc The document object.
 */
function transformFormsList(doc: any) {
  const formList = doc.querySelector('#navForm ul');
  if (!formList) return;

  const formItems = formList.querySelectorAll('li');
  formItems.forEach((item: any) => {
    // Find the span containing the form content
    const formContentSpan = item.querySelector('span[title]');
    if (formContentSpan) {
      const onclickAttr = formContentSpan.getAttribute('onclick');
      if (onclickAttr) {
        item.setAttribute('onclick', onclickAttr);
      }

      // Create a new div to wrap the content
      const contentWrapper = doc.createElement('div');
      contentWrapper.className = 'form-content';

      // Move the children of the span into the new wrapper
      while (formContentSpan.firstChild) {
        contentWrapper.appendChild(formContentSpan.firstChild);
      }

      // Replace the old span with the new wrapper
      formContentSpan.replaceWith(contentWrapper);
    }
  });
}

/**
 * Transforms the headers for pages, forms, and attachments, styling them correctly.
 * @param {Document} doc The document object.
 */
function transformHeaders(doc: any) {
  const navWrapper = doc.querySelector('#navWrapper');
  if (!navWrapper) return;

  // === 1. PAGES HEADER ===
  const oldPagesLabel = navWrapper.querySelector(
    'span[style*="font-weight:bold"]'
  );
  const navSpans = Array.from(navWrapper.children).filter(
    (child: any) =>
      child.tagName === 'SPAN' &&
      (child.textContent.trim() === 'First' ||
        child.textContent.trim() === 'Last')
  );

  if (oldPagesLabel) {
    const pagesHeader = doc.createElement('div');
    pagesHeader.className = 'section-header';
    const pagesTitle = doc.createElement('span');
    pagesTitle.textContent = 'Pages';
    pagesHeader.appendChild(pagesTitle);
    const pagesNav = doc.createElement('div');
    pagesNav.className = 'pages-nav';
    navSpans.forEach((span: any) => {
      const newSpan = doc.createElement('span');
      newSpan.textContent = span.textContent;
      newSpan.setAttribute('onclick', span.getAttribute('onclick'));
      pagesNav.appendChild(newSpan);
      span.remove();
    });
    pagesHeader.appendChild(pagesNav);
    oldPagesLabel.replaceWith(pagesHeader);
  }

  // === 2. FORMS HEADER ===
  const navFormHeader = doc.querySelector('#navFormHeader');
  if (navFormHeader) {
    navFormHeader.className = 'section-header';
    const brTag = navFormHeader.querySelector('br');
    if (brTag) brTag.remove();
    const formsSpan = navFormHeader.querySelector('span');
    if (formsSpan) {
      formsSpan.textContent = 'Forms';
      formsSpan.style.cssText = '';
    }
  }

  // === 3. ATTACHMENTS HEADER ===
  const attachmentsHeader = doc.querySelector('#navAttachmentsHeader');
  if (attachmentsHeader) {
    // wrap existingSpan and img in a new div
    const attachmentsWrapper = doc.createElement('div');
    attachmentsWrapper.className = 'section-header';
    const existingSpan = attachmentsHeader.querySelector('span');
    const existingImg = attachmentsHeader.querySelector(
      'img[onclick*="showAttachFileModal"]'
    );
    if (existingSpan) {
      existingSpan.remove();
      attachmentsWrapper.appendChild(existingSpan);
      existingSpan.textContent = 'Attachments';
      existingSpan.style.cssText = '';
    }
    if (existingImg) {
      existingImg.remove();
      attachmentsWrapper.appendChild(existingImg);
      const onclickFunction = existingImg.getAttribute('onclick');
      const plusButton = doc.createElement('button');
      plusButton.className = 'attachments-plus-btn';
      plusButton.innerHTML = '+';
      plusButton.setAttribute('onclick', onclickFunction);

      existingImg.replaceWith(plusButton);
    }
    attachmentsHeader.insertBefore(
      attachmentsWrapper,
      attachmentsHeader.firstChild
    );
  }
}

/**
 * Generates and returns a new sidebar element with all transformations applied.
 * @param {Document} doc The document object.
 * @returns {HTMLElement|undefined} The new sidebar element, or undefined if the original wrapper isn't found.
 */
export function generateSidebarElement(doc: any) {
  const navWrapper = doc.querySelector('#navWrapper');
  if (!navWrapper) return;

  // Inject styles into the document head
  injectSidebarStyles(doc);

  // === 1. TRANSFORM HEADERS ===
  transformHeaders(doc);

  // === 2. PAGES LIST ===
  const navPage = doc.querySelector('#navPage');
  if (navPage) {
    const docUlList = navPage.querySelector('ul');
    if (docUlList) {
      transformULBackgroundToImg(docUlList, doc);
    }
  }

  // === 3. FORMS LIST ===
  const navForm = doc.querySelector('#navForm');
  if (navForm) {
    transformFormsList(doc);
    const formItems = navForm.querySelectorAll('li');
    formItems.forEach((item: any) => {
      const formContentSpan = item.querySelector('span[title]');
      if (formContentSpan) {
        const onclickAttr = formContentSpan.getAttribute('onclick');
        if (onclickAttr) {
          item.setAttribute('onclick', onclickAttr);
        }
        formContentSpan.removeAttribute('onclick');

        const contentWrapper = doc.createElement('div');
        contentWrapper.className = 'form-content';
        while (formContentSpan.firstChild) {
          contentWrapper.appendChild(formContentSpan.firstChild);
        }
        formContentSpan.replaceWith(contentWrapper);
      }
    });
  }

  // === 4. ATTACHMENTS LIST AND FOOTER ===
  const originalFooter = doc.querySelector('#footer');
  if (originalFooter) {
    const footerText = originalFooter.textContent;
    const newFooter = doc.createElement('div');
    newFooter.className = 'sidebar-footer';
    newFooter.textContent = footerText;

    navWrapper.appendChild(newFooter);
    originalFooter.remove();
  }

  return navWrapper;
}

/**
 * Injects the custom CSS styles for the sidebar into the document head.
 * @param {Document} doc The document object.
 */
function injectSidebarStyles(doc: any) {
  const customSidebarStyle = doc.createElement('style');
  customSidebarStyle.innerHTML = SIDEBAR_STYLES;
  doc.head.appendChild(customSidebarStyle);
}
