import React, { useEffect, useRef, useState } from 'react';
import { featheryDoc, featheryWindow } from './browser';

const handleCustomScriptError = (e: PromiseRejectionEvent | ErrorEvent) => {
  const errorReason =
    (e as PromiseRejectionEvent).reason ?? (e as ErrorEvent).error;
  // If stack is at 'eval', it is a logic rule error.
  // Note this only works for unhandledrejection events, not error events.
  console.warn(
    'Error caught in custom HTML. Error Message: ',
    errorReason.message ?? ''
  );
  e.stopPropagation();
  e.preventDefault(); // Prevent the error in the log
};

// Allows running scripts in dangerous HTML
function DangerouslySetHtmlContent({ html = '', ...rest }: any) {
  const divRef = useRef<any>(null);
  const isFirstRender = useRef(true);
  const [removeScriptHandler, setRemoveScriptHandler] = useState(false);

  useEffect(() => {
    if (!isFirstRender.current) return;
    isFirstRender.current = false;

    featheryWindow().addEventListener('error', handleCustomScriptError);
    const slotHtml = featheryDoc().createRange().createContextualFragment(html); // Create a 'tiny' document and parse the html string
    divRef.current.innerHTML = ''; // Clear the container
    divRef.current.appendChild(slotHtml); // Append the new content
    setRemoveScriptHandler(true);
  }, [html, divRef]);

  useEffect(() => {
    if (removeScriptHandler) {
      // Remove error handler on next render. Only used to catch script errors
      // on first render
      featheryWindow().removeEventListener('error', handleCustomScriptError);
    }
  }, [removeScriptHandler]);

  return <div {...rest} ref={divRef} />;
}

export default DangerouslySetHtmlContent;
