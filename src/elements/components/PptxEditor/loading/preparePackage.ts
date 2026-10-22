import { unzipPptx, type ZipParts } from '../core/opc/zip';
import { parseXml, type OTree } from '../core/opc/xml';

export interface PreparedPackage {
  parts: ZipParts;
  trees: Map<string, OTree>;
  estimatedBytes: number;
}

/** Pure data only: object URLs and editable models belong to the UI owner. */
export function preparePackage(bytes: Uint8Array): PreparedPackage {
  const parts = unzipPptx(bytes);
  const trees = new Map<string, OTree>();
  let estimatedBytes = 0;
  for (const [path, text] of parts.text) {
    estimatedBytes += text.length * 2;
    try {
      const tree = parseXml(text);
      trees.set(path, tree);
      estimatedBytes += JSON.stringify(tree).length * 2;
    } catch {
      // Preserve the importer's lazy error semantics. Opaque/unused XML parts
      // must round-trip unchanged; a required part still fails when tree()
      // reads it while constructing the editable deck.
    }
  }
  for (const bytes of parts.binary.values()) estimatedBytes += bytes.byteLength;
  return { parts, trees, estimatedBytes };
}
