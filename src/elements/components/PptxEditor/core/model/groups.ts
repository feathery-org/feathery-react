import { child, childrenOf, getAttr, setAttr, el } from '../opc/xml';
import { readShapeNode } from './read';
import { refreshSlideModel } from './import';
import type { Deck, Shape, Slide } from './types';

// Translation-only groups can be dissolved without changing text metrics or
// introducing skew into rotated children. Other transforms stay grouped.
export function canUngroup(shape: Shape | undefined): boolean {
  if (!shape || shape.type !== 'group' || !shape.xfrm || !shape.spPr)
    return false;
  const { cx, cy, rot, flipH, flipV } = shape.xfrm;
  const xfrm = child(shape.spPr, 'a:xfrm');
  const ext = xfrm && child(xfrm, 'a:chExt');
  return (
    !rot &&
    !flipH &&
    !flipV &&
    !!ext &&
    Number(getAttr(ext, 'cx')) === cx &&
    Number(getAttr(ext, 'cy')) === cy
  );
}

export function ungroupShape(deck: Deck, slide: Slide, group: Shape): string[] {
  const geometry = group.xfrm;
  const xfrm = group.spPr && child(group.spPr, 'a:xfrm');
  if (!canUngroup(group) || !geometry || !xfrm)
    throw new Error(
      'This group transform cannot be ungrouped without changing its appearance.'
    );
  const offset = child(xfrm, 'a:chOff');
  const dx = geometry.x - Number((offset && getAttr(offset, 'x')) || 0);
  const dy = geometry.y - Number((offset && getAttr(offset, 'y')) || 0);
  const members = childrenOf(group.node)
    .map((node) => readShapeNode(node))
    .filter((shape): shape is Shape => !!shape);
  for (const member of members) {
    if (!member.xfrm) continue;
    const transform =
      (member.spPr && child(member.spPr, 'a:xfrm')) ||
      child(member.node, 'p:xfrm');
    if (!transform) continue;
    let off = child(transform, 'a:off');
    if (!off) {
      off = el('a:off');
      childrenOf(transform).unshift(off);
    }
    setAttr(off, 'x', String(member.xfrm.x + dx));
    setAttr(off, 'y', String(member.xfrm.y + dy));
  }
  const nodes = childrenOf(slide.spTree);
  const index = nodes.indexOf(group.node);
  if (index < 0) throw new Error('Group is not on this slide.');
  nodes.splice(index, 1, ...members.map((member) => member.node));
  deck.pkg.markDirty(slide.path);
  refreshSlideModel(deck, slide);
  return members.map((member) => member.id);
}
