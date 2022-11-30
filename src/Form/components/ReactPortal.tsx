import { useLayoutEffect, useState, PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

export default function ReactPortal({
  portal,
  children
}: PropsWithChildren<any>): any {
  const [rootEl, setRootEl] = useState<Element | null>(null);

  useLayoutEffect(() => {
    if (!portal) return () => {};

    let root: any = document.querySelector('.feathery-modal-root');
    if (!root) {
      root = document.createElement('div');
      root.style.cssText =
        'position:fixed;height:100vh;width:100vw;top:0;left:0;display:flex;align-items:center;justify-content:center;background-color:rgba(0, 0, 0, 0.4);';
      root.classList.add('feathery-modal-root');
      document.body.appendChild(root);
    }
    setRootEl(root);

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.removeChild(root);
      document.body.style.overflow = 'auto';
    };
  }, [portal]);

  if (!portal) return children;
  else if (!rootEl) return null;
  else return createPortal(children, rootEl);
}
