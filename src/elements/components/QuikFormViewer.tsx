import React, { useEffect, useState } from 'react';
import { featheryDoc } from '../../utils/browser';

interface FrameProps {
  html: string;
  css?: any;
  setShow?: (val: boolean) => void;
}

function QuikFormViewer(props: FrameProps) {
  const { html, css, setShow = () => {} } = props;
  const [modifiedHtml, setModifiedHtml] = useState('');

  useEffect(() => {
    if (html) {
      const document = featheryDoc();
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;

      // Remove Logo for back button
      tempDiv.querySelector('#headerlogo')?.remove();
      tempDiv.querySelector('.ui-widget-overlay')?.remove();

      // disable scrolling on iframe <html> which is causing floating 'Back' button on scroll
      const styleTag = document.createElement('style');
      styleTag.type = 'text/css';
      styleTag.innerHTML = `
         html {
           overflow: hidden !important;
         }
       `;
      tempDiv.prepend(styleTag);

      const dialog = tempDiv.querySelector('div[role="dialog"]');
      if (dialog) {
        const dialogElement = dialog as HTMLElement;
        const newOverlay = document.createElement('div');

        dialogElement.style.left = '36px';
        dialogElement.style.top = '40%';

        newOverlay.classList.add('ui-widget-overlay', 'ui-front');
        dialog.parentNode?.insertBefore(newOverlay, dialog);
      }

      if (modifiedHtml !== tempDiv.innerHTML)
        setModifiedHtml(tempDiv.innerHTML);
    }
  }, [html]);

  return (
    <div
      css={{
        position: 'relative',
        backgroundColor: '#fff',
        minWidth: '100vw',
        height: '100%',
        overflow: 'hidden'
      }}
    >
      <button
        css={{
          backgroundColor: '#e2626e',
          color: '#fff',
          border: '2px solid #e2626e',
          padding: '8px 15px',
          borderRadius: '6px',
          position: 'absolute',
          top: '24px',
          left: '16px',
          fontWeight: '600',
          '&:hover': { cursor: 'pointer' }
        }}
        onClick={() => setShow(false)}
      >
        Back
      </button>
      {modifiedHtml && (
        <iframe
          src='about:blank'
          srcDoc={modifiedHtml}
          css={{
            width: '100%',
            height: '100vh',
            border: 'none',
            outline: 'none',
            overflow: 'hidden',
            margin: 0,
            padding: 0,
            ...css
          }}
        />
      )}
    </div>
  );
}

export default QuikFormViewer;
