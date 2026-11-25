// Resolve a slide's background to a renderer-friendly descriptor. Walks
// slide -> layout -> master, like the SVG renderer. Handles solid, gradient, and
// image (blipFill) fills; theme/scheme fills fall through to null (SVG mode is the
// high-fidelity path for those).

import {
  child,
  children,
  descendant,
  getAttr,
  root as xmlRoot
} from '../opc/xml';
import type { OPCPackage } from '../opc/package';
import { trackObjectUrl } from '../opc/objectUrls';
import type { Deck, Slide } from './types';

export type BgDescriptor =
  | { kind: 'solid'; color: string }
  | {
      kind: 'gradient';
      angleDeg: number;
      stops: { offset: number; color: string }[];
    }
  | { kind: 'image'; src: string }
  | null;

function srgb(parent: ReturnType<typeof child>): string | undefined {
  const s = parent && child(parent, 'a:srgbClr');
  const v = s && getAttr(s, 'val');
  return v ? `#${v}` : undefined;
}

function mimeFor(path: string): string {
  const ext = (path.split('.').pop() || 'png').toLowerCase();
  return ext === 'jpg' || ext === 'jpeg'
    ? 'image/jpeg'
    : ext === 'gif'
    ? 'image/gif'
    : ext === 'svg'
    ? 'image/svg+xml'
    : 'image/png';
}

// Cache object URLs per package+part so repeated canvas rebuilds don't leak them.
const urlCache = new WeakMap<OPCPackage, Map<string, string>>();
function bgImageUrl(pkg: OPCPackage, target: string): string | undefined {
  const bytes = pkg.binary(target);
  if (!bytes || typeof URL === 'undefined' || !URL.createObjectURL)
    return undefined;
  let m = urlCache.get(pkg);
  if (!m) {
    m = new Map();
    urlCache.set(pkg, m);
  }
  let url = m.get(target);
  if (!url) {
    url = trackObjectUrl(
      pkg,
      URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: mimeFor(target) })
      )
    );
    m.set(target, url);
  }
  return url;
}

export function resolveSlideBg(deck: Deck, slide: Slide): BgDescriptor {
  const pkg = deck.pkg;
  const chain = [slide.path];
  const layout = pkg.layoutFor(slide.path);
  if (layout) chain.push(layout);
  const master = layout && pkg.masterFor(layout);
  if (master) chain.push(master);
  for (const part of chain) {
    if (!pkg.hasPart(part)) continue;
    const cSld = child(xmlRoot(pkg.tree(part)), 'p:cSld');
    const bg = cSld && child(cSld, 'p:bg');
    const bgPr = bg && child(bg, 'p:bgPr');
    if (!bgPr) continue;
    const blipFill = child(bgPr, 'a:blipFill');
    if (blipFill) {
      const blip = descendant(blipFill, 'a:blip');
      const rid = blip && getAttr(blip, 'r:embed');
      const target = rid ? pkg.relTarget(part, rid) : undefined;
      const src = target ? bgImageUrl(pkg, target) : undefined;
      return src ? { kind: 'image', src } : null;
    }
    const solid = child(bgPr, 'a:solidFill');
    if (solid) {
      const c = srgb(solid);
      return c ? { kind: 'solid', color: c } : null;
    }
    const grad = child(bgPr, 'a:gradFill');
    if (grad) {
      const lst = child(grad, 'a:gsLst');
      const stops = children(lst || grad, 'a:gs').map((gs) => ({
        offset: Number(getAttr(gs, 'pos')) / 100000 || 0,
        color: srgb(gs) || '#000000'
      }));
      const lin = child(grad, 'a:lin');
      const angleDeg = lin ? (Number(getAttr(lin, 'ang')) || 0) / 60000 : 90;
      return { kind: 'gradient', angleDeg, stops };
    }
    return null;
  }
  return null;
}
