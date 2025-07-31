import React, { useEffect, useMemo } from 'react';
import { featheryDoc } from '../../utils/browser';
import { generateHeaderElement } from './QuikFormViewer/transforms/header';
import { generateFormElement } from './QuikFormViewer/transforms/form';
import { generateSidebarElement } from './QuikFormViewer/transforms/sidebar';

interface FrameProps {
  html: string;
  css?: any;
  setShow?: (val: boolean) => void;
}

function QuikFormViewer({ html, css, setShow = () => {} }: FrameProps) {
  const processHtml = (rawHtml: string): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');

    // Disable scrolling on iframe <html> to fix floating back button UI issue
    const styleTag = doc.createElement('style');
    styleTag.innerHTML = `
      html {
        overflow: hidden !important;
      }
      
      body > div {
        display: flex;
        width: 100vw;
        height: 100vh;
        flex-direction: column;
      }

      body > div > table {
        display: contents;
      }
    `;
    doc.head.prepend(styleTag);

    const header = generateHeaderElement(doc);
    const form = generateFormElement(doc);
    const sidebar = generateSidebarElement(doc);

    // remove the body div's content and append the new header
    const bodyDiv = doc.body.querySelector('div');
    if (bodyDiv) {
      bodyDiv.innerHTML = '';
      if (header) {
        bodyDiv.appendChild(header);
      }
      const contentDiv = doc.createElement('div');
      contentDiv.style.flex = '1';
      contentDiv.style.overflow = 'auto';
      contentDiv.style.display = 'flex';
      bodyDiv.appendChild(contentDiv);
      if (form) {
        contentDiv.appendChild(form);
      }
      if (sidebar) {
        contentDiv.appendChild(sidebar);
      }
    }

    return doc.documentElement.outerHTML;
  };

  const memoizedProcessedHtml = useMemo(() => processHtml(html), [html]);

  useEffect(() => {
    featheryDoc().body.style.overflow = 'hidden';

    return () => {
      featheryDoc().body.style.removeProperty('overflow');
    };
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'QUIK_BACK_BUTTON_CLICK') {
        setShow(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [setShow]);

  return (
    <div
      css={{
        position: 'fixed',
        backgroundColor: '#fff',
        minWidth: '100vw',
        height: '100%',
        overflow: 'hidden',
        zIndex: 9999
      }}
    >
      {memoizedProcessedHtml && (
        <iframe
          src='about:blank'
          srcDoc={memoizedProcessedHtml}
          css={{
            width: '100%',
            height: '100vh',
            border: 'none',
            outline: 'none',
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
