import React, { useEffect, useRef } from 'react';
import { featheryDoc } from './browser';

// Allows running scripts in dangerous HTML
function DangerouslySetHtmlContent({ html = '', ...rest }: any) {
  const divRef = useRef<any>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (!isFirstRender.current) return;
    isFirstRender.current = false;

    const slotHtml = featheryDoc().createRange().createContextualFragment(html); // Create a 'tiny' document and parse the html string
    divRef.current.innerHTML = ''; // Clear the container
    divRef.current.appendChild(slotHtml); // Append the new content
  }, [html, divRef]);

  return <div {...rest} ref={divRef} />;
}

export default DangerouslySetHtmlContent;
