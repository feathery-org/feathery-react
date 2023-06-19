import { useEffect, useRef } from 'react';

export default function useMounted() {
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true; // Handle remount
    return () => {
      mounted.current = false;
    };
  }, []);

  return mounted;
}
