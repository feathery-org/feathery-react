import { useLayoutEffect, useState } from 'react';
import { featheryWindow } from '../utils/browser';

export default function useOverlayMeasurement(anchorRef: {
  current: HTMLElement | null;
}) {
  const [dropdownWidth, setWidth] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const win = featheryWindow() as any;

    const measure = () => {
      const wrapper = anchorRef.current;
      if (!wrapper) return;
      const { width } = wrapper.getBoundingClientRect();
      setWidth(width > 0 ? width : undefined);
    };

    // Guard against SSR/mocked environments and ensure listener APIs exist
    if (
      !win ||
      typeof win.addEventListener !== 'function' ||
      typeof win.removeEventListener !== 'function'
    )
      return;

    win.addEventListener('resize', measure);
    measure();

    return () => {
      win.removeEventListener('resize', measure);
    };
  }, [anchorRef]);

  return dropdownWidth;
}
