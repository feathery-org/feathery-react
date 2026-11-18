import type {
  RichPara,
  TextStyle
} from '../../../../../elements/components/PptxEditor/core/model/edit';
import { canonicalJson, type NfNode } from '../../../tree';
import {
  RUN_FORMAT,
  paragraphAt,
  runAt,
  textSources,
  type Location
} from '../textSources';
import type { DeckOperation, ShapeRef, SlideRef } from '../seams/deck';
import { leafRuns } from '../tree';

const paragraphsOf = (node: NfNode) => node.paragraphs as NfNode[];

function breakLocation(
  before: NfNode,
  id: string
): { paragraph: number; run: number } | undefined {
  for (const [p, paragraph] of paragraphsOf(before).entries()) {
    const r = leafRuns(paragraph).findIndex((run) => run.id === id);
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

/** Where each link of the shape starts, the run the editor copies the link from */
function linkStarts(shape: NfNode): Map<string, Location> {
  const starts = new Map<string, Location>();
  paragraphsOf(shape).forEach((paragraph, p) => {
    let r = 0;
    for (const run of paragraph.runs as NfNode[]) {
      if (run.kind === 'link') starts.set(run.id, { paragraph: p, run: r });
      r += run.kind === 'link' ? (run.runs as NfNode[]).length : 1;
    }
  });
  return starts;
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
  const starts = linkStarts(before);
  // Each run with the link it sits in, none when it is outside every link
  const linked = (paragraph: NfNode) =>
    (paragraph.runs as NfNode[]).flatMap((run) =>
      run.kind === 'link'
        ? (run.runs as NfNode[]).map((inner) => ({
            run: inner,
            link: starts.get(origin(run.id)) ?? null
          }))
        : [{ run, link: null }]
    );
  const paragraphs: RichPara[] = paragraphsOf(after).map((paragraph, p) => {
    const source = sources.paragraphs[p];
    const from = source === undefined ? undefined : paragraphAt(before, source);
    const rich: RichPara = {
      ...(source === undefined ? {} : { sourceParagraph: source }),
      runs: linked(paragraph).map(({ run, link }, r) => {
        if (run.kind === 'break') {
          const own = breakLocation(before, origin(run.id));
          return { text: '', break: true, ...(own ? { source: own } : {}) };
        }
        const at = sources.runs[p][r];
        return {
          text: String(run.text),
          ...(at ? { source: at, styleChanged: false } : {}),
          link
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
    leafRuns(paragraph).forEach((run, r) => {
      const start = offset;
      offset += String(run.text).length;
      if (run.kind !== 'run' || start === offset) return;
      const at = sources.runs[p][r];
      const style = styleChange(at ? runAt(before, at) : {}, run);
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
