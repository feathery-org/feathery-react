import { applySlideJSON } from './applyJson';
import { deckToJSON, slideToJSON, type DeckJSON, type SlideJSON } from './json';
import { refreshSlideModel, rebuildSlides } from './import';
import type { Deck } from './types';
import type { OTree } from '../opc/xml';
import { deepClone } from '../opc/deepClone';

const PRES = 'ppt/presentation.xml';
const CONTENT_TYPES = '[Content_Types].xml';

/**
 * The package-level parts that define which slides exist and in what order:
 * presentation.xml (its <p:sldIdLst>), its rels, [Content_Types] (slide
 * Overrides), and each slide's rels. Captured so undo/redo can reconstruct a
 * slide that was added or deleted, not just per-slide content.
 */
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
  sourceSlides: Record<string, OTree>;
  /**
   * Per-slide OPCPackage.mutationSeq at capture time. Lets the next capture
   * reuse this snapshot's clones for untouched slides (structural sharing),
   * so a commit's cost scales with the changed slides, not the deck.
   */
  slideSeqs: Record<string, number>;
  /** The slide manifest (see PptxSlideManifest). */
  manifest: PptxSlideManifest;
  /**
   * Combined mutationSeq of every manifest part. When unchanged between
   * snapshots the manifest is reused by reference, so an ordinary content edit
   * never re-clones the manifest.
   */
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

/**
 * Reconcile the package's slide set to match `target` before content restore:
 * restore the manifest parts, add back missing slide parts (from the target's
 * captured bodies), drop extra ones, then rebuild deck.slides.
 */
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
  deck.slides.forEach((slide, i) => {
    const seq = deck.pkg.mutationSeq(slide.path);
    slideSeqs[slide.path] = seq;
    const previousSlide =
      previous && previous.slideSeqs[slide.path] === seq
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

function restoreSourceSlide(deck: Deck, path: string, raw: OTree): void {
  const slide = deck.slides.find((candidate) => candidate.path === path);
  if (!slide) throw new Error(`History cannot restore missing slide ${path}`);
  const restored = clone(raw);
  slide.raw.splice(0, slide.raw.length, ...restored);
  deck.pkg.markDirty(path);
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
  return { slides: changes, deck: structural };
}
