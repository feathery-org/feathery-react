export const MAX_DOM_NAME_LENGTH = 64;

/**
 * First non-empty candidate, whitespace-collapsed and capped, for use as a
 * readable `name` attribute.
 */
export function readableName(...candidates: any[]): string | undefined {
  for (const candidate of candidates) {
    const name = (candidate ?? '').toString().replace(/\s+/g, ' ').trim();
    if (name) return name.slice(0, MAX_DOM_NAME_LENGTH);
  }
  return undefined;
}

/**
 * `name` props for elements that have no native naming attribute (plain
 * divs), so tools that read the form DOM can attribute an interaction to the
 * element instead of seeing an anonymous div. Browsers and assistive tech
 * ignore `name` outside form controls, so this changes no behaviour.
 */
export function nameProps(...candidates: any[]): Record<string, string> {
  const name = readableName(...candidates);
  return name ? { name } : {};
}
