import React from 'react';

function Frame({ html = '' }) {
  const handleLoad = (iframe: HTMLIFrameElement | null) => {
    if (iframe) {
      const childDocument = iframe.contentWindow?.document;
      if (childDocument) {
        iframe.contentWindow?.scrollTo(0, 0);

        // Manipulate dialog and overlay
        const dialog = childDocument.querySelector('div[role="dialog"]');
        const overlay = childDocument.querySelector('.ui-widget-overlay');

        // Remove existing overlay
        overlay?.remove();

        if (dialog) {
          // Adjust dialog position
          (dialog as HTMLElement).style.left = '36px';
          (dialog as HTMLElement).style.top = '40%';

          // Create and insert new overlay behind the dialog
          const newOverlay = childDocument.createElement('div');
          newOverlay.classList.add('ui-widget-overlay', 'ui-front');
          dialog.parentNode?.insertBefore(newOverlay, dialog);
        }
      }
    }
  };

  return (
    <iframe
      src='about:blank'
      srcDoc={html}
      onLoad={(e) => handleLoad(e.currentTarget)}
      css={{
        width: '100%',
        height: '80vh',
        border: 'none',
        outline: 'none',
        margin: 0,
        padding: 0
      }}
    />
  );
}

export default Frame;
