/**
 * The section marker (`<<scbr>>`, `<<scbr:continuous>>`): a template paragraph that becomes a
 * section break when a template is imported. In an open document it is plain text; the pack marks
 * it so the model can find it and the knowledge card can explain it, and never writes it.
 */
import type { FeatureMark } from '../../../pack';
import type { NfNode } from '../../../tree';
import { KIND } from '../adapter/keys';

export const SECTION_MARKER = /^<<scbr(?::(continuous))?>>$/;

export function sectionMarkerMark(
  node: NfNode,
  text: string | null
): FeatureMark[] {
  if (node.kind !== KIND.paragraph || text === null) return [];
  const m = SECTION_MARKER.exec(text.trim());
  return m
    ? [{ name: 'section-marker', value: m[1] ? 'continuous' : 'page' }]
    : [];
}
