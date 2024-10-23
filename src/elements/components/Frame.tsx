import React, { useEffect, useRef } from 'react';

function Frame({ html = '' }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (iframeRef.current && html) {
      iframeRef.current.contentWindow?.document.open();
      iframeRef.current.contentWindow?.document.write(html);
      iframeRef.current.contentWindow?.document.close();
    }
  }, [html]);

  return (
    <iframe
      src='about:blank'
      ref={iframeRef}
      css={{
        width: '800px',
        height: '800px',
        border: 'none',
        outline: 'none',
        margin: 0,
        padding: 0
      }}
    />
  );
}

export default Frame;
