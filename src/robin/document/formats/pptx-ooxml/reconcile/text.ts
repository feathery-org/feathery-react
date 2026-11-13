import type {
  RichPara,
  TextStyle
} from '../../../../../elements/components/PptxEditor/core/model/edit';
import { canonicalJson, type NfNode } from '../../../tree';
import {
  RUN_FORMAT,
  UNSOURCED_RUN_FORMAT,
  paragraphAt,
  runAt,
  textSources
} from '../textSources';
import type { DeckOperation, ShapeRef, SlideRef } from '../seams/deck';

const paragraphsOf = (node: NfNode) => node.paragraphs as NfNode[];

function breakLocation(
  before: NfNode,
  id: string
): { paragraph: number; run: number } | undefined {
  for (const [p, paragraph] of paragraphsOf(before).entries()) {
    const r = (paragraph.runs as NfNode[]).findIndex((run) => run.id === id);
    if (r >= 0) return { paragraph: p, run: r };
  }
  return undefined;
}

function styleChange(
  from: Record<string, unknown>,
  to: NfNode
): TextStyle | null {
  const style: TextStyle = {};
  for (const key of RUN_FORMAT) {
    const value = to[key];
    if (value === undefined || value === from[key]) continue;
    if (key === 'size') style.sizePt = value as number;
    else if (key === 'color')
      style.color = String(value).replace('#', '').toUpperCase();
    else if (key === 'font') style.font = value as string;
    else style[key] = value as boolean;
  }
  return Object.keys(style).length ? style : null;
}

/** New text as the editor's own edits, then the formatting of each run that differs from what it continues */
export function textOperations(
  slide: SlideRef,
  shape: ShapeRef,
  before: NfNode,
  after: NfNode,
  origin: (id: string) => string = (id) => id
): DeckOperation[] {
  if (
    canonicalJson(paragraphsOf(before)) === canonicalJson(paragraphsOf(after))
  )
    return [];
  const sources = textSources(before, after, origin);
  const paragraphs: RichPara[] = paragraphsOf(after).map((paragraph, p) => {
    const source = sources.paragraphs[p];
    const from = source === undefined ? undefined : paragraphAt(before, source);
    const rich: RichPara = {
      ...(source === undefined ? {} : { sourceParagraph: source }),
      runs: (paragraph.runs as NfNode[]).map((run, r) => {
        if (run.kind === 'break') {
          const own = breakLocation(before, origin(run.id));
          return { text: '', break: true, ...(own ? { source: own } : {}) };
        }
        const at = sources.runs[p][r];
        return {
          text: String(run.text),
          ...(at ? { source: at, styleChanged: false } : {})
        };
      })
    };
    if (paragraph.align !== undefined && paragraph.align !== from?.align)
      rich.align = paragraph.align as RichPara['align'];
    if (paragraph.level !== undefined && paragraph.level !== from?.level)
      rich.level = paragraph.level as number;
    return rich;
  });
  const operations: DeckOperation[] = [
    {
      command: {
        type: 'replace-rich-text',
        onSlide: slide,
        onShape: shape,
        paragraphs
      }
    }
  ];

  paragraphsOf(after).forEach((paragraph, p) => {
    let offset = 0;
    (paragraph.runs as NfNode[]).forEach((run, r) => {
      const start = offset;
      offset += String(run.text).length;
      if (run.kind !== 'run' || start === offset) return;
      const at = sources.runs[p][r];
      const style = styleChange(
        at ? runAt(before, at) : UNSOURCED_RUN_FORMAT,
        run
      );
      if (style)
        operations.push({
          command: {
            type: 'format-text',
            onSlide: slide,
            onShape: shape,
            style,
            ranges: [{ paragraph: p, start, end: offset }]
          }
        });
    });
  });
  return operations;
}
