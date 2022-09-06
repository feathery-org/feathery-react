import React, { useEffect, useRef } from 'react';
import { dynamicImport } from '../../integrations/utils';

let LOTTIE_PROMISE = Promise.resolve();

const LOTTIE_URL =
  'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.9.6/lottie_light.min.js';

// Load Lottie dynamically due to large package size & infrequent usage
export function loadLottieLight() {
  LOTTIE_PROMISE = LOTTIE_PROMISE.then(() => dynamicImport(LOTTIE_URL));
}

export default function Lottie({ animationData }: any) {
  const lottieRef = useRef();

  useEffect(() => {
    LOTTIE_PROMISE.then(() =>
      global.lottie.loadAnimation({
        container: lottieRef.current,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData
      })
    );
  }, []);

  // @ts-expect-error TS(2322): Type 'MutableRefObject<undefined>' is not assignab... Remove this comment to see the full error message
  return <div ref={lottieRef} css={{ pointerEvents: 'none' }} />;
}
