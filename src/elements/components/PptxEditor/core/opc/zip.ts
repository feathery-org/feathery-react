// Unzip / rezip a .pptx (an OPC ZIP package) with fflate.
// Text parts (XML/rels) are decoded to strings; binary parts (images, fonts)
// are kept as raw bytes so they survive the round trip untouched.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

export interface ZipParts {
  /** path -> UTF-8 text, for the XML/rels parts */
  text: Map<string, string>;
  /** path -> bytes, for binary parts (images, media, fonts) */
  binary: Map<string, Uint8Array>;
  /** original order of paths, to rebuild the archive predictably */
  order: string[];
}

const TEXT_EXT = /\.(xml|rels)$/i;

export function unzipPptx(bytes: Uint8Array): ZipParts {
  const files = unzipSync(bytes);
  const parts: ZipParts = { text: new Map(), binary: new Map(), order: [] };
  for (const path of Object.keys(files)) {
    parts.order.push(path);
    const data = files[path];
    if (TEXT_EXT.test(path)) {
      parts.text.set(path, strFromU8(data));
    } else {
      parts.binary.set(path, data);
    }
  }
  return parts;
}

export function zipPptx(parts: ZipParts): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const seen = new Set<string>();
  const add = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    if (parts.text.has(path)) files[path] = strToU8(parts.text.get(path)!);
    else if (parts.binary.has(path)) files[path] = parts.binary.get(path)!;
  };
  for (const path of parts.order) add(path);
  // include any parts added after load that weren't in the original order
  for (const path of parts.text.keys()) add(path);
  for (const path of parts.binary.keys()) add(path);
  return zipSync(files, { level: 6 });
}
