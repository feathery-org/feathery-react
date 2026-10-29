// Central registry of object URLs created while rendering/editing a package.
// Every createObjectURL in the PPTX core registers here so the owning editor
// instance can revoke them all when the document is replaced or disposed.

const registry = new WeakMap<object, Set<string>>();

/** Track an object URL against its owner (typically the OPCPackage). */
export function trackObjectUrl(owner: object, url: string): string {
  let urls = registry.get(owner);
  if (!urls) {
    urls = new Set();
    registry.set(owner, urls);
  }
  urls.add(url);
  return url;
}

/** Revoke every object URL created for this owner. Safe to call repeatedly. */
export function releaseObjectUrls(owner: object): void {
  const urls = registry.get(owner);
  if (!urls) return;
  registry.delete(owner);
  if (typeof URL === 'undefined' || !URL.revokeObjectURL) return;
  urls.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Already revoked or unsupported environment - nothing to do.
    }
  });
}
