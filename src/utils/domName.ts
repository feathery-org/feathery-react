export const MAX_DOM_NAME_LENGTH = 64;

/**
 * First candidate with usable content, restricted to ASCII letters, digits,
 * underscores and hyphens for DOM scanners. Other runs become underscores;
 * leading/trailing disallowed characters are dropped, then the name is capped.
 * Only for descriptive names: field control names/ids must retain their original
 * keys because value and validation lookups depend on an exact match.
 */
export function readableName(...candidates: any[]): string | undefined {
  for (const candidate of candidates) {
    const name = (candidate ?? '')
      .toString()
      .replace(/[^a-zA-Z0-9_-]+/g, ' ')
      .trim()
      .replace(/ /g, '_');
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
