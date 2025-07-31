const MIN_HEADER_HEIGHT = 58;
const HEADER_BACKGROUND_COLOR = '#333849';
const HEADER_TEXT_COLOR = '#FFFFFF';
const SUBTITLE_COLOR = '#A3AABA';
const BUTTON_BORDER_COLOR = '#DBDFE8';
const BUTTON_TEXT_COLOR = '#333849';
const SIGN_BUTTON_BACKGROUND = '#13A669';
const SIGN_BUTTON_COLOR = '#FFFFFF';
const SIGN_BUTTON_ICON = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M18.3346 10.0003C18.3346 14.6027 14.6037 18.3337 10.0013 18.3337C5.39893 18.3337 1.66797 14.6027 1.66797 10.0003C1.66797 5.39795 5.39893 1.66699 10.0013 1.66699C14.6037 1.66699 18.3346 5.39795 18.3346 10.0003ZM14.2272 8.18772C14.6069 7.78665 14.5895 7.15372 14.1885 6.77404C13.7874 6.39436 13.1545 6.4117 12.7748 6.81277L9.23894 10.5478L7.72525 8.9578C7.34445 8.55779 6.71147 8.54222 6.31147 8.92303C5.91146 9.30384 5.8959 9.93681 6.2767 10.3368L8.5167 12.6898C8.70579 12.8884 8.96815 13.0006 9.24238 13.0002C9.51661 12.9999 9.77866 12.8869 9.96719 12.6877L14.2272 8.18772Z" fill="white"/>
</svg>`;
const BACK_BUTTON_ICON = `<svg width="16" height="12" viewBox="0 0 16 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 6L1 6M1 6L6.5 1M1 6L6.5 11" stroke="#333849" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

const HEADER_STYLES = `
    /* Header */
    #header {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        gap: 10px;
        width: 100%;
        height: auto; /* Allow header height to adapt to content */
        background: ${HEADER_BACKGROUND_COLOR};
        box-sizing: border-box;
        flex-shrink: 0;
        z-index: 1000;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1); /* Subtle shadow */
        min-height: ${MIN_HEADER_HEIGHT}px;
    }

    /* Back button inside header */
    .back-button {
        display: flex;
        flex-direction: row;
        justify-content: center;
        align-items: center;
        padding: 13px 19px;
        gap: 6px;
        width: auto;
        height: 36px;
        background: #FFFFFF;
        border: 1px solid #DBDFE8;
        border-radius: 7px;
        flex-shrink: 0;
        cursor: pointer;
        transition: background-color 0.2s, border-color 0.2s;
    }
    .back-button:hover {
        background-color: #f0f0f0;
        border-color: #c0c0c0;
    }

    .back-button .back-button-icon {
        width: 16px;
        height: 11.72px;
        flex-shrink: 0;
    }


    /* Title Section */
    .title-section {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
        padding: 0px;
        width: auto;
        flex: 1; /* Allow title section to grow and take available space */
        min-width: 0; /* Allow content to shrink */
    }

    .title-section .title {
        font-family: 'Inter', sans-serif;
        font-style: normal;
        font-weight: 600;
        font-size: 16px;
        line-height: 22px;
        display: flex;
        align-items: center;
        color: ${HEADER_TEXT_COLOR};
        flex-shrink: 0;
        margin: -3px 0px;
        white-space: nowrap; /* Keep title on one line */
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .title-section .subtitle {
        font-family: 'Inter', sans-serif;
        font-style: normal;
        font-weight: 400;
        font-size: 14px;
        line-height: 22px;
        display: block; /* Allow subtitle to wrap */
        color: ${SUBTITLE_COLOR};
        flex-shrink: 0;
        word-wrap: break-word; /* Allow long words to break */
        overflow-wrap: break-word; /* Standard property for word wrapping */
        min-width: 0; /* Allow text to wrap within available space */
    }

    /* Action Buttons container */
    .action-buttons {
        display: flex;
        flex-direction: row;
        align-items: center;
        padding: 0px;
        gap: 7px;
        flex-shrink: 0; /* Prevent buttons from shrinking */
    }

    /* Common button styling */
    .action-buttons .button, #btnSign#btnSign {
        display: flex;
        flex-direction: row;
        justify-content: center;
        align-items: center;
        padding: 8px 13.5px;
        gap: 6px;
        height: 36px;
        border-radius: 7px;
        font-family: 'Axiforma', sans-serif;
        font-style: normal;
        font-weight: 600;
        font-size: 14px;
        line-height: 20px;
        cursor: pointer;
        transition: background-color 0.2s, border-color 0.2s, color 0.2s;
        white-space: nowrap;
    }

    /* Reset and Download buttons (white background) */
    .action-buttons .reset-button,
    .action-buttons .download-button {
        background: ${HEADER_TEXT_COLOR};
        border: 1px solid ${BUTTON_BORDER_COLOR};
        color: ${BUTTON_TEXT_COLOR};
    }
    .action-buttons .reset-button:hover,
    .action-buttons .download-button:hover {
        background-color: #f0f0f0;
        border-color: #c0c0c0;
    }

    /* Sign button (green background) */
    .action-buttons .sign-button {
        background: ${SIGN_BUTTON_BACKGROUND};
        border: none;
        color: ${SIGN_BUTTON_COLOR} !important;
    }
    .action-buttons .sign-button:hover {
        background-color: #108a5a;
    }

    /* Check Icon for Sign button */
    .action-buttons .sign-button .check-icon {
        width: 16.67px;
        height: 16.67px;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }
    .action-buttons .sign-button .check-icon svg {
        width: 100%;
        height: 100%;
    }

    /* Override existing styles from the old header structure */
    #header table, #header tbody, #header tr, #header td {
        display: contents;
    }
    #header a { display: none; }
    #header input[type="button"] { display: none; }
    .ctn-sign-btn { display: none; }
    .ctn-sign-btn img { display: none; }
`;

function extractHeaderContent(oldHeader: HTMLDivElement) {
  const mainTitleSpan = oldHeader.querySelector('#majortitle');
  const minorInstructionsSpan = oldHeader.querySelector('#MinorInstructions');
  const btnReset = oldHeader.querySelector('#btnReset') as HTMLInputElement;
  const btnPrint = oldHeader.querySelector('#btnPrint') as HTMLInputElement;
  const btnSignContainer = oldHeader.querySelector('.ctn-sign-btn');
  const btnSign = btnSignContainer
    ? (btnSignContainer.querySelector(
        'input[type="button"]'
      ) as HTMLInputElement)
    : null;

  const titleText = mainTitleSpan
    ? mainTitleSpan.textContent
    : 'Form Name Goes Here';
  const subtitleText = minorInstructionsSpan
    ? minorInstructionsSpan.textContent
    : 'Review and complete your documents below.';

  return { titleText, subtitleText, btnReset, btnPrint, btnSign };
}

function createNewHeaderElements(
  doc: Document,
  content: ReturnType<typeof extractHeaderContent>
): HTMLDivElement {
  const newHeader = doc.createElement('div');
  newHeader.id = 'header';

  // Back button (now inside the header)
  const backButton = doc.createElement('button');
  backButton.className = 'back-button';
  backButton.innerHTML = BACK_BUTTON_ICON;

  backButton.setAttribute(
    'onclick',
    `window.parent.postMessage({ type: 'QUIK_BACK_BUTTON_CLICK' }, '*');`
  );

  newHeader.appendChild(backButton);

  // Title Section
  const titleSection = doc.createElement('div');
  titleSection.className = 'title-section';

  const titleDiv = doc.createElement('div');
  titleDiv.className = 'title';
  titleDiv.textContent = content.titleText;

  const subtitleDiv = doc.createElement('div');
  subtitleDiv.className = 'subtitle';
  subtitleDiv.textContent = content.subtitleText;

  titleSection.appendChild(titleDiv);
  titleSection.appendChild(subtitleDiv);
  newHeader.appendChild(titleSection);

  // Action Buttons
  const actionButtons = doc.createElement('div');
  actionButtons.className = 'action-buttons';

  // Reset Button
  if (content.btnReset) {
    const resetButton = doc.createElement('button');
    resetButton.className = 'button reset-button';
    resetButton.textContent = content.btnReset.value;
    resetButton.id = content.btnReset.id;
    actionButtons.appendChild(resetButton);
  }

  // Download Button
  if (content.btnPrint) {
    const downloadButton = doc.createElement('button');
    downloadButton.className = 'button download-button';
    downloadButton.textContent = content.btnPrint.value;
    downloadButton.id = content.btnPrint.id;
    actionButtons.appendChild(downloadButton);
  }

  // Sign Button
  if (content.btnSign) {
    const signButton = doc.createElement('button');
    signButton.className = 'button sign-button';
    const signIcon = doc.createElement('div');
    signIcon.className = 'check-icon';
    signIcon.innerHTML = SIGN_BUTTON_ICON;
    signButton.appendChild(signIcon);
    const signText = doc.createElement('span');
    signText.textContent = content.btnSign.value;
    signButton.appendChild(signText);
    signButton.id = content.btnSign.id;
    actionButtons.appendChild(signButton);
  }

  newHeader.appendChild(actionButtons);

  return newHeader;
}

function replaceHeader(
  oldHeader: HTMLDivElement,
  newHeader: HTMLDivElement
): void {
  oldHeader.replaceWith(newHeader);
}

function injectHeaderStyles(doc: Document): void {
  const customHeaderStyle = doc.createElement('style');
  customHeaderStyle.innerHTML = HEADER_STYLES;
  doc.head.appendChild(customHeaderStyle);
}

export function transformHeaderHtml(doc: Document): void {
  const oldHeader = doc.querySelector('#header') as HTMLDivElement;

  if (!oldHeader) {
    console.warn(
      'Header element with ID "header" not found. Header transformation skipped.'
    );
    return;
  }

  const extractedContent = extractHeaderContent(oldHeader);
  const newHeader = createNewHeaderElements(doc, extractedContent);
  replaceHeader(oldHeader, newHeader);
  injectHeaderStyles(doc);
}
