import { useLayoutEffect, useState, PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

export default function ReactPortal({
  options,
  children
}: PropsWithChildren<any>): any {
  const [rootEl, setRootEl] = useState<Element | null>(null);

  useLayoutEffect(() => {
    if (!options?.show) return () => {};

    let root: any = document.querySelector('.feathery-modal-root');
    if (!root) {
      root = document.createElement('div');
      root.style.cssText =
        'position:fixed;z-index:10;height:100vh;width:100vw;border-radius:10px;top:0;left:0;overflow-y:auto;display:flex;background-color:rgba(0, 0, 0, 0.4);backdrop-filter:blur(2px);';
      root.classList.add('feathery-modal-root');
      root.addEventListener('click', (e: any) => {
        if (e.target === root && options.onHide) options.onHide();
      });
      document.body.appendChild(root);
    }
    setRootEl(root);

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.removeChild(root);
      document.body.style.overflow = 'auto';
    };
  }, [options?.show]);

  if (!options) return children;
  else if (!rootEl || !options.show) return null;
  else return createPortal(children, rootEl);
}
