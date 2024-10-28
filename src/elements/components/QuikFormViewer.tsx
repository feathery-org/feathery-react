import React, { useEffect, useMemo, useState } from 'react';

interface FrameProps {
  html: string;
  css?: any;
  setShow?: (val: boolean) => void;
}

function QuikFormViewer(props: FrameProps) {
  const { html, css, setShow = () => {} } = props;
  const [processedHtml, setProcessedHtml] = useState('');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(false);
  }, [html]);

  const processHtml = (rawHtml: string): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');

    // Remove Logo for back button
    const headerLogo = doc.querySelector('#headerlogo');
    if (headerLogo) headerLogo.remove();

    // Disable scrolling on iframe <html> to fix floating back button UI issue
    const styleTag = doc.createElement('style');
    styleTag.innerHTML = `
      html {
        overflow: hidden !important;
      }
    `;
    doc.head.prepend(styleTag);

    return doc.documentElement.outerHTML;
  };

  const memoizedProcessedHtml = useMemo(() => processHtml(html), [html]);

  useEffect(() => {
    setProcessedHtml(memoizedProcessedHtml);
    setIsReady(true);
  }, [memoizedProcessedHtml]);

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
      {processedHtml && isReady && (
        <iframe
          src='about:blank'
          srcDoc={processedHtml}
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
