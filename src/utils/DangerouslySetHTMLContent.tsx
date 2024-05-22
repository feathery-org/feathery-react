import React, { useEffect, useRef, useState } from 'react';
import { featheryDoc } from './browser';
import { removeCustomErrorHandler, setCustomErrorHandler } from './error';

// Allows running scripts in dangerous HTML
function DangerouslySetHtmlContent({ html = '', ...rest }: any) {
  const divRef = useRef<any>(null);
  const isFirstRender = useRef(true);
  const [removeScriptHandler, setRemoveScriptHandler] = useState(false);

  useEffect(() => {
    if (!isFirstRender.current) return;
    isFirstRender.current = false;

    setCustomErrorHandler();
    const slotHtml = featheryDoc().createRange().createContextualFragment(html); // Create a 'tiny' document and parse the html string
    divRef.current.innerHTML = ''; // Clear the container
    divRef.current.appendChild(slotHtml); // Append the new content
    setRemoveScriptHandler(true);
  }, [html, divRef]);

  useEffect(() => {
    if (removeScriptHandler) {
      // Remove error handler on next render. Only used to catch script errors
      // on first render
      removeCustomErrorHandler();
    }
  }, [removeScriptHandler]);

  return <div {...rest} ref={divRef} />;
}

export default DangerouslySetHtmlContent;
