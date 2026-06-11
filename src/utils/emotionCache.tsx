import { PropsWithChildren } from 'react';
import createCache, { EmotionCache } from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { featheryDoc, runningInClient } from './browser';

let cache: EmotionCache | undefined;

// Emotion-generated rules and user CSS class selectors (e.g.
// `.feathery-table-cell`) have equal specificity, so whichever stylesheet
// appears later in the document wins. Anchoring Feathery's emotion style tags
// at the top of <head> guarantees user stylesheets come later, letting users
// override default styles with a plain single-class selector. Element-selector
// CSS resets on host pages still lose to the class-level default styles.
//
// Only called in the browser — see FeatheryCacheProvider.
function getFeatheryCache(): EmotionCache {
  if (!cache) {
    const doc = featheryDoc();
    let insertionPoint: HTMLElement | undefined =
      doc.querySelector('meta[name="feathery-emotion-insertion-point"]') ??
      undefined;
    if (!insertionPoint) {
      insertionPoint = doc.createElement('meta') as HTMLElement;
      insertionPoint.setAttribute('name', 'feathery-emotion-insertion-point');
      doc.head.insertBefore(insertionPoint, doc.head.firstChild);
    }
    cache = createCache({ key: 'feathery', insertionPoint });
  }
  return cache;
}

export function FeatheryCacheProvider({
  children
}: PropsWithChildren<unknown>) {
  // On the server, fall through to emotion's default behavior (a fresh cache
  // per render tree) so SSR style extraction keeps working across requests —
  // a module-level singleton cache would mark styles as inserted after the
  // first request and stop emitting them. Stylesheet ordering only matters in
  // the browser anyway.
  if (!runningInClient()) return <>{children}</>;
  return <CacheProvider value={getFeatheryCache()}>{children}</CacheProvider>;
}
