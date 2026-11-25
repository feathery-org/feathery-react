import type { OPCPackage } from '../core/opc/package';

type Entry = {
  owner: OPCPackage;
  path: string;
  revision: number;
  svg: SVGSVGElement;
  bytes: number;
};
// Global disposable-preview budget across visited tabs. Mounted visible SVGs
// are owned by their hosts; evicting an entry never evicts edits or history.
const entries: Entry[] = [];
const MAX_ENTRIES = 48;
const MAX_BYTES = 8 * 1024 * 1024;

export function cachedThumbnail(
  owner: OPCPackage,
  path: string,
  revision: number
) {
  const index = entries.findIndex(
    (entry) =>
      entry.owner === owner &&
      entry.path === path &&
      entry.revision === revision
  );
  if (index < 0) return undefined;
  const [entry] = entries.splice(index, 1);
  entries.push(entry);
  return entry.svg;
}

export function cacheThumbnail(
  owner: OPCPackage,
  path: string,
  revision: number,
  svg: SVGSVGElement
) {
  for (let i = entries.length - 1; i >= 0; i--)
    if (entries[i].owner === owner && entries[i].path === path)
      entries.splice(i, 1);
  // Conservative accounting from the serialized markup, not an exact heap size.
  // Avoids a second full DOM walk (querySelectorAll) on every cached thumbnail.
  const bytes = svg.outerHTML.length * 3;
  if (bytes > MAX_BYTES) return;
  entries.push({ owner, path, revision, svg, bytes });
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  while (entries.length > MAX_ENTRIES || total > MAX_BYTES) {
    const removed = entries.shift();
    if (removed) total -= removed.bytes;
  }
}

export function releaseThumbnails(owner: OPCPackage) {
  for (let i = entries.length - 1; i >= 0; i--)
    if (entries[i].owner === owner) entries.splice(i, 1);
}

export function clearThumbnailCache() {
  entries.splice(0);
}
