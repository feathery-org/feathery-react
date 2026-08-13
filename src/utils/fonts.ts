import { featheryDoc, runningInClient } from './browser';

const loadedGoogleFonts = new Set<string>();

/**
 * Loads Google fonts via a stylesheet link rather than webfontloader, which
 * has no way to pass `display` through to the CSS API. Without it Google's
 * response omits font-display, so the browser falls back to the default block
 * period and text renders invisible on a cold cache until the font arrives.
 *
 * @param families webfontloader-style specs, e.g. 'Inter:400,400italic,700'
 */
export function loadGoogleFonts(families: string[]) {
  if (!runningInClient()) return;

  const newFamilies = families.filter(
    (family) => family && !loadedGoogleFonts.has(family)
  );
  if (!newFamilies.length) return;
  newFamilies.forEach((family) => loadedGoogleFonts.add(family));

  const link = featheryDoc().createElement('link');
  link.rel = 'stylesheet';
  // Google's v1 CSS API: families joined by '|', spaces as '+'
  link.href = `https://fonts.googleapis.com/css?family=${newFamilies
    .map((family) => family.replace(/ /g, '+'))
    .join('%7C')}&display=swap`;
  // On a failed stylesheet request, unmark the families so a later call (e.g.
  // another form load or signature remount) retries instead of skipping them
  // for the rest of the page session
  link.onerror = () => {
    newFamilies.forEach((family) => loadedGoogleFonts.delete(family));
    link.remove();
  };
  featheryDoc().head.appendChild(link);
}
