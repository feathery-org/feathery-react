import React, { useLayoutEffect, useState, PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import { featheryDoc } from '../../utils/browser';

export default function ReactPortal({
  options,
  children
}: PropsWithChildren<any>): any {
  const [rootEl, setRootEl] = useState<Element | null>(null);

  useLayoutEffect(() => {
    if (!options?.show) return () => {};

    let root: any = featheryDoc().querySelector('.feathery-modal-root');
    if (!root) {
      root = featheryDoc().createElement('div');
      root.style.cssText =
        'position:fixed;z-index:10;height:100vh;width:100vw;top:0;left:0;overflow-y:auto;display:flex;background-color:rgba(0, 0, 0, 0.4);backdrop-filter:blur(2px);';
      root.classList.add('feathery-modal-root');
      root.addEventListener('click', (e: any) => {
        if (e.target === root && options.onHide) options.onHide();
      });
      featheryDoc().body.appendChild(root);
    }
    setRootEl(root);

    featheryDoc().body.style.overflow = 'hidden';

    return () => {
      featheryDoc().body.removeChild(root);
      featheryDoc().body.style.overflow = 'auto';
    };
  }, [options?.show]);

  if (!options) return children;
  else if (!rootEl || !options.show) return null;
  else
    return createPortal(
      <div css={{ margin: 'auto', padding: '32px' }}>{children}</div>,
      rootEl
    );
}
