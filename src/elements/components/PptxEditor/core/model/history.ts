import { applySlideJSON } from './applyJson';
import { deckToJSON, slideToJSON, type DeckJSON, type SlideJSON } from './json';
import { refreshSlideModel, rebuildSlides } from './import';
import { presentationSizeType, setPresentationSize } from './slideSize';
import { readShapeNode } from './read';
import type { Deck, Slide } from './types';
import { child, childrenOf, root, type ONode, type OTree } from '../opc/xml';
import { deepClone } from '../opc/deepClone';

const PRES = 'ppt/presentation.xml';
const CONTENT_TYPES = '[Content_Types].xml';

// The parts that define which slides exist and their order (presentation.xml,
// its rels, content-type Overrides, each slide's rels). Captured so undo/redo
// can reconstruct an added/deleted slide, not just per-slide content.
export interface PptxSlideManifest {
  presentation: OTree;
  presentationRels: OTree;
  contentTypes: OTree;
  slideRels: Record<string, OTree>;
}

/**
 * A history state is JSON-first: `document` is the public editable projection.
 * `sourceSlides` is an internal JSON-form fallback for edits the projection
 * cannot reconstruct yet (for example deleting an unsupported imported shape).
 */
export interface PptxHistorySnapshot {
  document: DeckJSON;
  presentationSizeType?: string;
  sourceSlides: Record<string, OTree>;
  /**
   * Per-slide OPCPackage.mutationSeq at capture time. Lets the next capture
   * reuse this snapshot's clones for untouched slides (structural sharing),
   * so a commit's cost scales with the changed slides, not the deck.
   */
  slideSeqs: Record<string, number>;
  /** The slide manifest (see PptxSlideManifest). */
  manifest: PptxSlideManifest;
  // Combined mutationSeq of every manifest part; when unchanged between
  // snapshots the manifest is reused by reference (no re-clone).
  manifestSeq: number;
}

export interface PptxHistoryEntry {
  id: number;
  label: string;
  before: PptxHistorySnapshot;
  after: PptxHistorySnapshot;
}

export interface HistorySlideChange {
  path: string;
  shapeIds: string[];
  background: boolean;
  structure: boolean;
  slideSize: boolean;
  /** The raw OOXML changed without a corresponding difference in public JSON. */
  fullContent: boolean;
}

export interface HistoryRestoreResult {
  slides: HistorySlideChange[];
  /** The slide set/order changed (add/delete/duplicate); redraw the deck. */
  deck?: boolean;
  /** The presentation-wide slide size changed (every slide re-renders). */
  size: boolean;
}

const clone = <T>(value: T): T => deepClone(value);
const serialized = (value: unknown): string => JSON.stringify(value);

function manifestSeqOf(deck: Deck): number {
  const pkg = deck.pkg;
  let sum =
    pkg.mutationSeq(PRES) +
    pkg.mutationSeq(pkg.relsPath(PRES)) +
    pkg.mutationSeq(CONTENT_TYPES);
  // mutationSeqs are monotonic, so an equal sum means no manifest part changed.
  for (const slide of deck.slides)
    sum += pkg.mutationSeq(pkg.relsPath(slide.path));
  return sum;
}

function captureManifest(deck: Deck): PptxSlideManifest {
  const pkg = deck.pkg;
  const slideRels: Record<string, OTree> = {};
  for (const slide of deck.slides) {
    const relsPath = pkg.relsPath(slide.path);
    if (pkg.hasPart(relsPath))
      slideRels[slide.path] = clone(pkg.tree(relsPath));
  }
  const presRels = pkg.relsPath(PRES);
  return {
    presentation: clone(pkg.tree(PRES)),
    presentationRels: pkg.hasPart(presRels) ? clone(pkg.tree(presRels)) : [],
    contentTypes: clone(pkg.tree(CONTENT_TYPES)),
    slideRels
  };
}

// Reconcile the package's slide set to `target` before content restore:
// restore manifest parts, re-add missing/drop extra slide parts, rebuild slides.
function reconcileManifest(deck: Deck, target: PptxHistorySnapshot): void {
  const pkg = deck.pkg;
  const m = target.manifest;
  pkg.setXmlPart(PRES, clone(m.presentation));
  if (m.presentationRels.length)
    pkg.setXmlPart(pkg.relsPath(PRES), clone(m.presentationRels));
  pkg.setXmlPart(CONTENT_TYPES, clone(m.contentTypes));

  const targetPaths = target.document.slides.map((slide) => slide.path);
  const targetSet = new Set(targetPaths);
  for (const path of targetPaths) {
    if (!pkg.hasPart(path)) {
      const raw = target.sourceSlides[path];
      if (!raw) throw new Error(`History has no body for slide ${path}`);
      pkg.setXmlPart(path, clone(raw));
    }
    const rels = m.slideRels[path];
    if (rels) pkg.setXmlPart(pkg.relsPath(path), clone(rels));
  }
  for (const slide of deck.slides) {
    if (!targetSet.has(slide.path)) {
      pkg.removePart(pkg.relsPath(slide.path));
      pkg.removePart(slide.path);
    }
  }
  rebuildSlides(deck);
}

export function captureHistorySnapshot(
  deck: Deck,
  previous?: PptxHistorySnapshot | null
): PptxHistorySnapshot {
  const sourceSlides: Record<string, OTree> = {};
  const slideSeqs: Record<string, number> = {};
  const slides: SlideJSON[] = [];
  // Slide JSON mirrors the presentation size, so a resize invalidates every
  // slide's projection even though no slide part was touched.
  const sameSize =
    !!previous &&
    previous.document.sizeEMU.cx === deck.size.cx &&
    previous.document.sizeEMU.cy === deck.size.cy;
  deck.slides.forEach((slide, i) => {
    const seq = deck.pkg.mutationSeq(slide.path);
    slideSeqs[slide.path] = seq;
    const previousSlide =
      previous && sameSize && previous.slideSeqs[slide.path] === seq
        ? previous.document.slides.find(
            (candidate) => candidate.path === slide.path
          )
        : undefined;
    if (previousSlide && previous) {
      // Untouched since the previous snapshot: share its (immutable) clones.
      sourceSlides[slide.path] = previous.sourceSlides[slide.path];
      slides.push(
        previousSlide.index === i + 1
          ? previousSlide
          : { ...previousSlide, index: i + 1 }
      );
      return;
    }
    // Match the editable JSON panel exactly: JSON serialization removes
    // undefined optional fields before validation/apply.
    sourceSlides[slide.path] = clone(slide.raw);
    slides.push(
      JSON.parse(JSON.stringify(slideToJSON(deck, slide, i))) as SlideJSON
    );
  });
  const manifestSeq = manifestSeqOf(deck);
  const manifest =
    previous && previous.manifestSeq === manifestSeq
      ? previous.manifest
      : captureManifest(deck);
  return {
    presentationSizeType: presentationSizeType(deck),
    document: {
      sizeEMU: { cx: deck.size.cx, cy: deck.size.cy },
      sizeInches: {
        w: +(deck.size.cx / 914400).toFixed(2),
        h: +(deck.size.cy / 914400).toFixed(2)
      },
      slideCount: deck.slides.length,
      slides
    },
    sourceSlides,
    slideSeqs,
    manifest,
    manifestSeq
  };
}

export function sameHistoryDocument(
  a: PptxHistorySnapshot,
  b: PptxHistorySnapshot
): boolean {
  if (a === b) return true;
  if (a.presentationSizeType !== b.presentationSizeType) return false;
  const docA = a.document;
  const docB = b.document;
  if (docA.slideCount !== docB.slideCount) return false;
  if (serialized(docA.sizeEMU) !== serialized(docB.sizeEMU)) return false;
  for (let i = 0; i < docA.slides.length; i++) {
    const slideA = docA.slides[i];
    const slideB = docB.slides[i];
    // Structural sharing makes untouched slides reference-equal.
    if (slideA !== slideB && serialized(slideA) !== serialized(slideB))
      return false;
    const rawA = a.sourceSlides[slideA.path];
    const rawB = b.sourceSlides[slideB.path];
    if (rawA !== rawB && serialized(rawA) !== serialized(rawB)) return false;
  }
  return true;
}

function slideJSON(
  snapshot: PptxHistorySnapshot,
  path: string
): SlideJSON | undefined {
  return snapshot.document.slides.find((slide) => slide.path === path);
}

const sameRaw = (a: OTree | undefined, b: OTree | undefined) =>
  a === b || serialized(a) === serialized(b);

/** The slides a change added or rewrote */
export function slidesChangedBetween(
  before: PptxHistorySnapshot,
  after: PptxHistorySnapshot
): Set<string> {
  return new Set(
    after.document.slides
      .map((slide) => slide.path)
      .filter(
        (path) =>
          !(path in before.sourceSlides) ||
          !sameRaw(before.sourceSlides[path], after.sourceSlides[path])
      )
  );
}

/** Whether the deck still has the slide order, size and package parts it had at `after`, and these slides as it left them */
export function unchangedSince(
  present: PptxHistorySnapshot,
  after: PptxHistorySnapshot,
  paths: Set<string>
): boolean {
  const order = (snapshot: PptxHistorySnapshot) =>
    serialized(snapshot.document.slides.map((slide) => slide.path));
  if (order(present) !== order(after)) return false;
  if (
    present.presentationSizeType !== after.presentationSizeType ||
    serialized(present.document.sizeEMU) !== serialized(after.document.sizeEMU)
  )
    return false;
  if (
    !sameRaw(present.manifest.contentTypes, after.manifest.contentTypes) ||
    !sameRaw(present.manifest.presentationRels, after.manifest.presentationRels)
  )
    return false;
  return [...paths].every((path) =>
    sameRaw(present.sourceSlides[path], after.sourceSlides[path])
  );
}

/** `target` with every slide outside `paths` as the deck has it now, so restoring it puts back only the slide order and those slides */
export function keepingOtherSlides(
  target: PptxHistorySnapshot,
  present: PptxHistorySnapshot,
  paths: Set<string>
): PptxHistorySnapshot {
  const isKept = (path: string) =>
    !paths.has(path) && path in present.sourceSlides;
  const slideRels: Record<string, OTree> = {};
  for (const slide of target.document.slides) {
    const rels = isKept(slide.path)
      ? present.manifest.slideRels[slide.path]
      : target.manifest.slideRels[slide.path];
    if (rels) slideRels[slide.path] = rels;
  }
  return {
    ...target,
    document: {
      ...target.document,
      slides: target.document.slides.map((slide) =>
        isKept(slide.path)
          ? {
              ...(slideJSON(present, slide.path) as SlideJSON),
              index: slide.index
            }
          : slide
      )
    },
    sourceSlides: Object.fromEntries(
      Object.entries(target.sourceSlides).map(([path, raw]) => [
        path,
        isKept(path) ? present.sourceSlides[path] : raw
      ])
    ),
    manifest: { ...target.manifest, slideRels }
  };
}

export function restoreSourceSlide(deck: Deck, path: string, raw: OTree): void {
  const slide = deck.slides.find((candidate) => candidate.path === path);
  if (!slide) throw new Error(`History cannot restore missing slide ${path}`);
  const restored = clone(raw);
  slide.raw.splice(0, slide.raw.length, ...restored);
  deck.pkg.markDirty(path);
  refreshSlideModel(deck, slide);
}

function shapeTreeChildren(raw: OTree): OTree {
  const cSld = child(root(raw), 'p:cSld');
  const spTree = cSld && child(cSld, 'p:spTree');
  return spTree ? childrenOf(spTree) : [];
}

/** A slide's top-level shapes in stacking order, read from its raw XML */
export function slideShapes(raw: OTree): Array<{ id: string; node: ONode }> {
  return shapeTreeChildren(raw).flatMap((node) => {
    const id = readShapeNode(node)?.id;
    return id ? [{ id, node }] : [];
  });
}

/** Put these top-level shapes back as an earlier copy of the slide had them, each where it sits now */
export function restoreShapes(
  deck: Deck,
  slide: Slide,
  earlierRaw: OTree,
  shapeIds: string[]
): void {
  const earlier = new Map(
    slideShapes(earlierRaw).map(({ id, node }) => [id, node])
  );
  const siblings = childrenOf(slide.spTree);
  for (const shapeId of shapeIds) {
    const index = siblings.findIndex(
      (node) => readShapeNode(node)?.id === shapeId
    );
    if (index < 0) continue;
    const node = earlier.get(shapeId);
    if (node) siblings[index] = clone(node);
    else siblings.splice(index, 1);
  }
  deck.pkg.markDirty(slide.path);
  refreshSlideModel(deck, slide);
}

/**
 * Put these top-level shapes back as an earlier copy of the slide had them, in its stacking order,
 * for a slide whose order has not changed since apart from these shapes
 */
export function restoreShapesInOrder(
  deck: Deck,
  slide: Slide,
  earlierRaw: OTree,
  shapeIds: string[]
): void {
  const targets = new Set(shapeIds);
  const siblings = childrenOf(slide.spTree);
  // Shapes by id, other nodes by XML plus which copy it is, so identical nodes stay apart
  const keysOf = (nodes: OTree) => {
    const copies = new Map<string, number>();
    return nodes.map((node) => {
      const id = readShapeNode(node)?.id;
      const base = id ? `shape:${id}` : JSON.stringify(node);
      copies.set(base, (copies.get(base) ?? 0) + 1);
      return `${base}#${copies.get(base)}`;
    });
  };
  for (let i = siblings.length - 1; i >= 0; i--)
    if (targets.has(readShapeNode(siblings[i])?.id ?? ''))
      siblings.splice(i, 1);

  // Each goes back right after the node that preceded it earlier, exact since the order is otherwise unchanged
  const earlier = shapeTreeChildren(earlierRaw);
  const earlierKeys = keysOf(earlier);
  earlier.forEach((node, index) => {
    if (!targets.has(readShapeNode(node)?.id ?? '')) return;
    const currentKeys = keysOf(siblings);
    let anchor = -1;
    for (let p = index - 1; p >= 0 && anchor < 0; p--)
      anchor = currentKeys.indexOf(earlierKeys[p]);
    siblings.splice(anchor + 1, 0, clone(node));
  });
  deck.pkg.markDirty(slide.path);
  refreshSlideModel(deck, slide);
}

function describeSlideChange(
  existing: SlideJSON,
  desired: SlideJSON
): HistorySlideChange {
  const before = new Map(existing.shapes.map((shape) => [shape.id, shape]));
  const after = new Map(desired.shapes.map((shape) => [shape.id, shape]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  const shapeIds = [...ids].filter(
    (id) => serialized(before.get(id)) !== serialized(after.get(id))
  );
  return {
    path: existing.path,
    shapeIds,
    background:
      serialized(existing.background) !== serialized(desired.background),
    structure:
      serialized(existing.shapes.map((shape) => shape.id)) !==
      serialized(desired.shapes.map((shape) => shape.id)),
    slideSize: serialized(existing.sizeEMU) !== serialized(desired.sizeEMU),
    fullContent: false
  };
}

/** Restore a JSON history state. Supported edits use the public JSON apply
 * path. If that path rejects a still-unmodeled edit, restore the slide's
 * internal JSON-form XML tree so undo remains lossless. */
export function restoreHistorySnapshot(
  deck: Deck,
  target: PptxHistorySnapshot
): HistoryRestoreResult {
  const structural =
    deck.slides.length !== target.document.slides.length ||
    deck.slides.some(
      (slide, i) => slide.path !== target.document.slides[i]?.path
    );
  if (structural) reconcileManifest(deck, target);
  const size = target.document.sizeEMU;
  const sizeChanged = size.cx !== deck.size.cx || size.cy !== deck.size.cy;
  if (sizeChanged || presentationSizeType(deck) !== target.presentationSizeType)
    setPresentationSize(deck, size.cx, size.cy, target.presentationSizeType);
  const current = deckToJSON(deck);
  const changes: HistorySlideChange[] = [];
  for (const slide of deck.slides) {
    const desired = slideJSON(target, slide.path);
    const existing = current.slides.find(
      (candidate) => candidate.path === slide.path
    );
    if (!desired || !existing)
      throw new Error(`Undo cannot match slide ${slide.path}`);
    const change = describeSlideChange(existing, desired);
    if (serialized(existing) === serialized(desired)) {
      const raw = target.sourceSlides[slide.path];
      if (raw && serialized(slide.raw) !== serialized(raw)) {
        restoreSourceSlide(deck, slide.path, raw);
        changes.push({ ...change, fullContent: true });
      }
      continue;
    }
    try {
      applySlideJSON(deck, slide, desired);
    } catch {
      const raw = target.sourceSlides[slide.path];
      if (!raw)
        throw new Error(`History has no source state for ${slide.path}`);
      restoreSourceSlide(deck, slide.path, raw);
    }
    changes.push(change);
  }
  return { slides: changes, deck: structural, size: sizeChanged };
}
