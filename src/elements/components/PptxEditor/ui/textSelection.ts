import { featheryDoc } from '../../../../utils/browser';
import type { TextRange } from '../core/model/edit';

/** Convert a browser selection in the SVG HTML text body to paragraph offsets. */
export function selectedTextRanges(
  root: HTMLElement,
  selection: Selection | null
): TextRange[] {
  if (!selection?.rangeCount || selection.isCollapsed) return [];
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return [];
  const paragraphs = [...root.children].filter((el) => el.nodeName === 'DIV');
  const result: TextRange[] = [];
  paragraphs.forEach((paragraph, index) => {
    let offset = 0;
    let start = Infinity;
    let end = -Infinity;
    const walker = featheryDoc().createTreeWalker(
      paragraph,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
    );
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (
        node instanceof HTMLBRElement &&
        node.hasAttribute('data-soft-break')
      ) {
        offset += 1;
        continue;
      }
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent || '';
      const parent = node.parentElement;
      if (parent?.closest('[data-bullet]')) continue;
      if (
        !parent?.closest('[contenteditable="false"]') &&
        text &&
        range.intersectsNode(node)
      ) {
        const from = range.startContainer === node ? range.startOffset : 0;
        const to = range.endContainer === node ? range.endOffset : text.length;
        if (from < to) {
          start = Math.min(start, offset + from);
          end = Math.max(end, offset + to);
        }
      }
      offset += text.length; // fields count in positions even though they are not styled
    }
    if (start < end) result.push({ paragraph: index, start, end });
  });
  return result;
}
