import { RefObject, useLayoutEffect } from 'react';
import { TABLE_CLASS } from './classNames';

// Portals leave the table's DOM subtree, so explicitly carry its resolved
// variables across (including the active responsive breakpoint).
export function getTablePortalStyles(anchor: HTMLElement | null) {
  const table = anchor?.closest(`.${TABLE_CLASS.container}`);
  const view = table?.ownerDocument.defaultView;
  if (!table || !view) return {};
  const computed = view.getComputedStyle(table);
  return Array.from(computed).reduce<Record<string, string>>((styles, name) => {
    if (!name.startsWith('--feathery-table-')) return styles;
    return { ...styles, [name]: computed.getPropertyValue(name) };
  }, {});
}

export function useTablePortalStyles(
  anchor: HTMLElement | null,
  portalRef: RefObject<HTMLElement | null>
) {
  // Run after every render so editor style changes also update an open menu.
  useLayoutEffect(() => {
    const portal = portalRef.current;
    const view = anchor?.ownerDocument.defaultView;
    if (!portal || !view) return;
    const sync = () => {
      Array.from(portal.style)
        .filter((name) => name.startsWith('--feathery-table-'))
        .forEach((name) => portal.style.removeProperty(name));
      Object.entries(getTablePortalStyles(anchor)).forEach(([name, value]) => {
        portal.style.setProperty(name, value);
      });
    };
    sync();
    view.addEventListener('resize', sync);
    return () => view.removeEventListener('resize', sync);
  });
}
