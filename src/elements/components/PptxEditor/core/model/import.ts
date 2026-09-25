// Parse an OPCPackage into a typed Deck. Each Shape/Run holds a reference into
// the raw XML tree, so later edits mutate the raw in place.

import { OPCPackage } from '../opc/package';
import { trackObjectUrl } from '../opc/objectUrls';
import {
  root,
  child,
  descendant,
  getAttr,
  childrenOf,
  type ONode
} from '../opc/xml';
import { readShapeNode } from './read';
import { resolveXfrm } from './resolve';
import type { Deck, Slide, Shape } from './types';
import { readEditorSlideSize } from './slideSize';

function imageUrl(
  pkg: OPCPackage,
  slidePath: string,
  node: ONode
): string | undefined {
  const blip = descendant(node, 'a:blip');
  const rid = blip && getAttr(blip, 'r:embed');
  if (!rid) return undefined;
  const target = pkg.relTarget(slidePath, rid);
  const bytes = target && pkg.binary(target);
  if (!bytes || typeof URL === 'undefined' || !URL.createObjectURL)
    return undefined;
  const ext = (target.split('.').pop() || 'png').toLowerCase();
  const mime =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'gif'
      ? 'image/gif'
      : ext === 'svg'
      ? 'image/svg+xml'
      : 'image/png';
  return trackObjectUrl(
    pkg,
    URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  );
}

function pictureRelationship(node: ONode): string | undefined {
  const blip = descendant(node, 'a:blip');
  return blip && getAttr(blip, 'r:embed');
}

export function readSlide(
  pkg: OPCPackage,
  path: string,
  retainedImages = new Map<string, string>()
): Slide {
  const raw = pkg.tree(path);
  const sld = root(raw); // p:sld
  const cSld = child(sld, 'p:cSld');
  const spTree = cSld && child(cSld, 'p:spTree');
  const shapes: Shape[] = [];
  if (spTree) {
    const opts = {
      imageSrc: (node: ONode) => {
        const relationship = pictureRelationship(node);
        return (
          (relationship && retainedImages.get(relationship)) ||
          imageUrl(pkg, path, node)
        );
      },
      relatedPart: (relationshipId: string) =>
        pkg.relTarget(path, relationshipId)
    };
    for (const node of childrenOf(spTree)) {
      const shape = readShapeNode(node, opts);
      if (shape) shapes.push(shape);
    }
  }
  return { path, spTree: spTree!, shapes, raw, size: readEditorSlideSize(raw) };
}

/** Rebuild the typed slide view after its raw JSON-form XML tree is restored. */
export function refreshSlideModel(deck: Deck, slide: Slide): void {
  const retainedImages = new Map<string, string>();
  for (const shape of slide.shapes) {
    const relationship = pictureRelationship(shape.node);
    if (relationship && shape.imageSrc)
      retainedImages.set(relationship, shape.imageSrc);
  }
  const refreshed = readSlide(deck.pkg, slide.path, retainedImages);
  const usedImages = new Set(
    refreshed.shapes
      .map((shape) => shape.imageSrc)
      .filter((source): source is string => !!source)
  );
  for (const source of retainedImages.values()) {
    if (
      !usedImages.has(source) &&
      source.startsWith('blob:') &&
      typeof URL !== 'undefined' &&
      URL.revokeObjectURL
    )
      URL.revokeObjectURL(source);
  }
  slide.spTree = refreshed.spTree;
  slide.shapes = refreshed.shapes;
  slide.size = refreshed.size;
  for (const shape of slide.shapes) {
    if (!shape.xfrm) {
      const x = resolveXfrm(deck, slide, shape);
      if (x) shape.xfrm = x;
    }
  }
}

/**
 * Rebuild `deck.slides` from the package's current slide order after a
 * structural change (add/delete/duplicate slide). Existing Slide objects are
 * reused by path so their resolved geometry and retained image URLs survive;
 * only newly added paths are read fresh.
 */
export function rebuildSlides(deck: Deck): void {
  const byPath = new Map(deck.slides.map((slide) => [slide.path, slide]));
  deck.slides = deck.pkg.slidePaths().map((path) => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const slide = readSlide(deck.pkg, path);
    for (const shape of slide.shapes) {
      if (!shape.xfrm) {
        const x = resolveXfrm(deck, slide, shape);
        if (x) shape.xfrm = x;
      }
    }
    return slide;
  });
}

export function importDeck(bytes: Uint8Array): Deck {
  const pkg = OPCPackage.open(bytes);
  const size = pkg.slideSize();
  const slides = pkg.slidePaths().map((p) => readSlide(pkg, p));
  const deck: Deck = { size, slides, pkg };
  // Placeholders often inherit their geometry from the layout/master (no a:xfrm on
  // the slide). Resolve it into the model view so they render and are selectable;
  // the raw node stays inherited until the user actually moves the shape.
  for (const slide of slides) {
    for (const shape of slide.shapes) {
      if (!shape.xfrm) {
        const x = resolveXfrm(deck, slide, shape);
        if (x) shape.xfrm = x;
      }
    }
  }
  return deck;
}
