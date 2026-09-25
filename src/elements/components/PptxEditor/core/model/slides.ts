// Slide-level structural edits: add a blank slide, duplicate a slide, delete a
// slide. Each keeps the OPC package self-consistent — the slide part, its
// _rels, the [Content_Types] Override, the presentation.xml.rels relationship,
// and the presentation.xml <p:sldIdLst> entry — then rebuilds deck.slides.

import { deepClone } from '../opc/deepClone';
import {
  child,
  children,
  childrenOf,
  el,
  getAttr,
  root,
  tagOf,
  type OTree
} from '../opc/xml';
import { rebuildSlides } from './import';
import type { Deck } from './types';

const REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SLIDE_REL = `${REL}/slide`;
const LAYOUT_REL = `${REL}/slideLayout`;
const SLIDE_CT =
  'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const PRES = 'ppt/presentation.xml';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';

function presRoot(deck: Deck) {
  return root(deck.pkg.tree(PRES));
}

/** The <p:sldIdLst>, created (in schema position, before <p:sldSz>) if absent. */
function sldIdLst(deck: Deck) {
  const pres = presRoot(deck);
  let lst = child(pres, 'p:sldIdLst');
  if (!lst) {
    lst = el('p:sldIdLst');
    const kids = childrenOf(pres);
    const szIdx = kids.findIndex((n) => tagOf(n) === 'p:sldSz');
    if (szIdx >= 0) kids.splice(szIdx, 0, lst);
    else kids.push(lst);
  }
  return lst;
}

function nextSldId(lst: ReturnType<typeof sldIdLst>): number {
  // OOXML requires slide ids in [256, 2^31); use max existing + 1.
  let max = 255;
  for (const s of children(lst, 'p:sldId')) {
    const id = Number(getAttr(s, 'id'));
    if (Number.isFinite(id)) max = Math.max(max, id);
  }
  return max + 1;
}

/** Relationship Target (relative to ppt/) for an absolute slide part path. */
function slideRelTarget(slidePath: string): string {
  return slidePath.replace(/^ppt\//, '');
}

/** A relationship Target from a slide part to an absolute package path. */
function targetFromSlide(absoluteTarget: string): string {
  // slides live in ppt/slides/, most siblings (layouts, media) one level up.
  return `../${absoluteTarget.replace(/^ppt\//, '')}`;
}

function blankSlideTree(): OTree {
  const spTree = el('p:spTree', undefined, [
    el('p:nvGrpSpPr', undefined, [
      el('p:cNvPr', { id: '1', name: '' }),
      el('p:cNvGrpSpPr'),
      el('p:nvPr')
    ]),
    el('p:grpSpPr')
  ]);
  const sld = el(
    'p:sld',
    { 'xmlns:a': A_NS, 'xmlns:r': REL, 'xmlns:p': P_NS },
    [
      el('p:cSld', undefined, [spTree]),
      el('p:clrMapOvr', undefined, [el('a:masterClrMapping')])
    ]
  );
  return [sld];
}

/**
 * Insert a slide at `atIndex`. When `sourcePath` is given the slide's body and
 * relationships are cloned (duplicate); otherwise a blank slide is created that
 * reuses the first slide's layout. Returns the new slide's part path.
 */
export function addSlide(
  deck: Deck,
  atIndex: number,
  sourcePath?: string
): string {
  const pkg = deck.pkg;
  const newPath = pkg.nextSlidePath();

  if (sourcePath) {
    // Duplicate: clone the body and every relationship (media/layout are
    // shared by reference — they are immutable parts).
    pkg.setXmlPart(newPath, deepClone(pkg.tree(sourcePath)));
    const srcRels = pkg.relsPath(sourcePath);
    if (pkg.hasPart(srcRels))
      pkg.setXmlPart(pkg.relsPath(newPath), deepClone(pkg.tree(srcRels)));
  } else {
    pkg.setXmlPart(newPath, blankSlideTree());
    // Reuse an existing slide's layout so the blank slide inherits a theme.
    const layout = deck.slides[0] && pkg.layoutFor(deck.slides[0].path);
    if (layout)
      pkg.addRelationship(newPath, LAYOUT_REL, targetFromSlide(layout));
  }

  pkg.ensureOverride(`/${newPath}`, SLIDE_CT);
  const rId = pkg.addRelationship(PRES, SLIDE_REL, slideRelTarget(newPath));

  const lst = sldIdLst(deck);
  const entry = el('p:sldId', { id: String(nextSldId(lst)), 'r:id': rId });
  const entries = childrenOf(lst);
  const clamped = Math.max(0, Math.min(atIndex, entries.length));
  entries.splice(clamped, 0, entry);
  pkg.markDirty(PRES);

  rebuildSlides(deck);
  return newPath;
}

/** Move the slide at `fromIndex` to `toIndex` (final position in the list). */
export function moveSlide(
  deck: Deck,
  fromIndex: number,
  toIndex: number
): void {
  const lst = sldIdLst(deck);
  const entries = childrenOf(lst);
  if (fromIndex < 0 || fromIndex >= entries.length) return;
  const [moved] = entries.splice(fromIndex, 1);
  const to = Math.max(0, Math.min(toIndex, entries.length));
  entries.splice(to, 0, moved);
  deck.pkg.markDirty(PRES);
  rebuildSlides(deck);
}

/** Delete a slide by part path. Leaves orphaned media parts (harmless). */
export function deleteSlide(deck: Deck, slidePath: string): void {
  const pkg = deck.pkg;
  const lst = sldIdLst(deck);
  const entries = childrenOf(lst);
  const idx = entries.findIndex((entry) => {
    const rid = getAttr(entry, 'r:id');
    return !!rid && pkg.relTarget(PRES, rid) === slidePath;
  });
  if (idx < 0) return;
  const rId = getAttr(entries[idx], 'r:id');
  entries.splice(idx, 1);
  pkg.markDirty(PRES);
  if (rId) pkg.removeRelationship(PRES, rId);
  pkg.removeOverride(`/${slidePath}`);
  pkg.removePart(pkg.relsPath(slidePath));
  pkg.removePart(slidePath);

  rebuildSlides(deck);
}
