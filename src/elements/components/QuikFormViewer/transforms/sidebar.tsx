// @ts-nocheck
const SIDEBAR_WIDTH = '300px';

const SIDEBAR_STYLES = `
  #navWrapper {
    width: ${SIDEBAR_WIDTH};
    flex-shrink: 0;
    height: 100%;
    position: static;
    background: #ffffff;      
    display: flex;
    flex-direction: column;
    padding: 16px 0;
    overflow-y: auto;
  }

  .pages-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    margin-bottom: 8px;
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
  }

  #navPage ul {
    width: 100%;
    padding: 0;
    margin: 0;
  }

  #navPage li {
    margin: 20px auto;
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

  #navPage, #navFormHeader, #navForm, #navAttachmentsHeader {
    position: static;
  }

  #navWrapper > #navAttachmentsHeader {
    width: unset;
    height: auto;
  }

  #sidebar-footer {
    padding: 10px;
    background: #fbeaea;
    color: #cb4e5a;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
  }

  /* Attachments styling */
  #navAttachmentsHeader {
    padding: 16px;
  }

  #navFormHeader, #navForm {
    padding: 0px 16px;
  }

  .attachments-title, #navFormHeader {
    height: auto;
    width: auto;
    font-size: 14px !important;
    line-height: 20px;
    font-weight: 600;
    color: #333849;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    margin-bottom: 8px;
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
    padding: 12px;
    border-bottom: 1px solid #dbdfe8;
    position: relative;
    min-height: 44px;
  }

  #navAttachments li:last-child, #navForm li:last-child {
    border-bottom: none;
  }

  /* Add document icon before each item */
  #navForm li::before {
    content: '';
    width: 25px;
    height: 25px;
    margin-right: 8px;
    background-image: url("data:image/svg+xml,%3Csvg width='25' height='25' viewBox='0 0 25 25' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='4.68555' y='2.6748' width='15.9657' height='19.6501' rx='2.45627' stroke='%23656A7D' stroke-width='1.8422' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M8.36914 6.97363H16.9661' stroke='%23656A7D' stroke-width='1.8422' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M8.36914 11.2715H16.9661' stroke='%23656A7D' stroke-width='1.8422' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M13.2812 17.4121H16.9657' stroke='%23656A7D' stroke-width='1.8422' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
    flex-shrink: 0;
  }

  #navForm li a {
    font-weight: 600;
    font-size: 14px;
    line-height: 20px;
    color: #333849;
    text-decoration: none;
  }

  #navForm li em {
    font-weight: 400;
    font-size: 12px;
    line-height: 18px;
    font-style: normal;
    color: #6C7589;
  }

  #navAttachments li::before {
    content: '';
    width: 25px;
    height: 25px;
    margin-right: 8px;
    background-image: url("data:image/svg+xml,%3Csvg width='26' height='26' viewBox='0 0 26 26' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M9.06504 8.70141V4.60032C9.06504 3.81303 9.70326 3.1748 10.4905 3.1748V3.1748C11.2778 3.1748 11.9161 3.81303 11.9161 4.60032V8.70141C11.9161 10.3971 10.5414 11.7717 8.84573 11.7717V11.7717C7.15003 11.7717 5.77539 10.3971 5.77539 8.70141V4.73788' stroke='%23656A7D' stroke-width='1.8422' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M15.4987 3.1748H19.2849C20.6414 3.1748 21.7411 4.27451 21.7411 5.63107V20.3687C21.7411 21.7252 20.6414 22.825 19.2849 22.825H8.23166C6.8751 22.825 5.77539 21.7252 5.77539 20.3687V15.5133' stroke='%23656A7D' stroke-width='1.8422' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
    flex-shrink: 0;
  }

  /* Style the filename span */
  #navAttachments li > span {
    font-family: 'Axiforma', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-style: normal;
    font-weight: 600;
    font-size: 14px;
    line-height: 20px;
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
    margin-left: auto;
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.2s ease;
    order: 2;
  }

  #navAttachments li > img[src*="remove.png"]:hover {
    opacity: 1;
  }
`;

// Helper function to extract full-size image URL from corresponding page div
function getFullSizeImageUrl(doc, thumbnailUrl) {
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

function transformULBackgroundToImg(ulElement, doc, options = {}) {
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

  listItems.forEach((li) => {
    // Look for div elements within the li that have background-image
    const divsWithBg = li.querySelectorAll('div[style*="background-image"]');

    divsWithBg.forEach((div) => {
      const style = div.style;
      const computedStyle = window.getComputedStyle(div);

      // Extract background-image URL
      let backgroundImage =
        style.backgroundImage || computedStyle.backgroundImage;

      if (!backgroundImage || backgroundImage === 'none') return;

      // Extract URL from background-image property
      const urlMatch = backgroundImage.match(/url\(['"]?([^'"]*?)['"]?\)/);
      if (!urlMatch) return;

      let imageUrl = urlMatch[1];

      // Decode URL if it's encoded
      try {
        imageUrl = decodeURIComponent(imageUrl);
      } catch (e) {
        // If decoding fails, use original URL
      }

      // Handle HTML entities like &amp;
      imageUrl = imageUrl.replace(/&amp;/g, '&');

      // Try to get full-size image URL
      const fullSizeUrl = getFullSizeImageUrl(doc, imageUrl);
      if (fullSizeUrl) {
        imageUrl = fullSizeUrl;
      }

      // Get existing title for alt text
      const altText = div.getAttribute('title') || 'Form Image';

      // Create new img element
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = altText;

      // Build image styles
      let imgStyles = `width: ${imageWidth};`;
      if (preserveAspectRatio) {
        imgStyles += ' height: auto; object-fit: contain; max-height: 100%;';
      }
      img.style.cssText = imgStyles;

      // Remove background properties if requested
      if (removeBackgroundImage) {
        div.style.backgroundImage = 'none';
        div.style.backgroundRepeat = 'none';
      }

      // Center image if requested
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

        // Handle existing content positioning (like span elements with numbers)
        const existingContent = Array.from(div.children);
        existingContent.forEach((child) => {
          if (child.tagName === 'SPAN') {
            child.style.position = 'absolute';

            // Preserve existing positioning if it exists
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

      // Insert the image at the beginning of the div
      div.insertBefore(img, div.firstChild);
      transformedCount++;
    });
  });

  return transformedCount;
}

function transformAttachments(doc: Document): void {
  const attachmentsHeader = doc.querySelector('#navAttachmentsHeader');
  if (!attachmentsHeader) return;

  // Get the onclick function from the existing img
  const existingImg = attachmentsHeader.querySelector(
    'img[onclick*="showAttachFileModal"]'
  );
  const onclickFunction = existingImg?.getAttribute('onclick');

  // Clear existing content
  attachmentsHeader.innerHTML = '';

  // Create title container with flex layout
  const titleContainer = doc.createElement('div');
  titleContainer.className = 'attachments-title';

  // Create title text
  const titleText = doc.createElement('span');
  titleText.textContent = 'Attachments';

  // Create plus button
  const plusButton = doc.createElement('button');
  plusButton.className = 'attachments-plus-btn';
  plusButton.innerHTML = '+';

  // Add the original onclick function to the plus button
  if (onclickFunction) {
    plusButton.setAttribute('onclick', onclickFunction);
  }

  titleContainer.appendChild(titleText);
  titleContainer.appendChild(plusButton);
  attachmentsHeader.appendChild(titleContainer);

  // Create attachments container
  const attachmentsContainer = doc.createElement('div');
  attachmentsContainer.id = 'navAttachments';
  const ul = doc.createElement('ul');
  attachmentsContainer.appendChild(ul);
  attachmentsHeader.appendChild(attachmentsContainer);
}

function getFooterText(doc: Document): string {
  const footer = doc.querySelector('#footer');
  return footer?.textContent || '';
}

export function generateSidebarElement(doc: Document): HTMLElement | undefined {
  const sidebar = doc.querySelector('#navWrapper');
  if (!sidebar) {
    console.warn('Sidebar element not found in the document.');
    return undefined;
  }

  injectSidebarStyles(doc);

  const docUlList = doc.querySelector('#navPage ul');
  if (docUlList) {
    transformULBackgroundToImg(docUlList, doc);
  }

  // Transform attachments
  transformAttachments(doc);

  const footerText = getFooterText(doc);
  if (footerText) {
    const footer = doc.createElement('div');
    footer.id = 'sidebar-footer';
    footer.textContent = footerText;
    sidebar.appendChild(footer);
  }

  return sidebar as HTMLDivElement;
}

function injectSidebarStyles(doc: Document): void {
  const customSidebarStyle = doc.createElement('style');
  customSidebarStyle.innerHTML = SIDEBAR_STYLES;
  doc.head.appendChild(customSidebarStyle);
}
